const API = {
  _userCache: {},

  config: {
    botUsername: 'Sicor12321',
    botProfileUrl: 'https://www.roblox.com/users/search?keyword=Sicor12321',
    gameId: '109983668079237',
    adminUsername: 'BrainrotUp!',
    vipUsername: 'Ma43584',
    vipMinAutoWinChance: 35,
    vipIncomeBlock: 30_000_000,
  },

  _userKey(user) {
    return `brainrotup_${user.toLowerCase()}`;
  },

  _globalKey() {
    return 'brainrotup_global_queue';
  },

  _loadGlobal() {
    const raw = localStorage.getItem(this._globalKey());
    if (raw) return JSON.parse(raw);
    return { deposits: [], withdraws: [] };
  },

  _saveGlobal(data) {
    localStorage.setItem(this._globalKey(), JSON.stringify(data));
  },

  _defaultUser() {
    return { balance: 0, inventory: [], history: [], pendingDeposits: [], pendingWithdraws: [] };
  },

  _loadLocal(user) {
    const key = user.toLowerCase();
    const raw = localStorage.getItem(this._userKey(key));
    if (raw) return JSON.parse(raw);
    return this._defaultUser();
  },

  _saveLocal(user, data) {
    localStorage.setItem(this._userKey(user.toLowerCase()), JSON.stringify(data));
  },

  _load(user) {
    const key = user.toLowerCase();
    if (this._userCache[key]) return JSON.parse(JSON.stringify(this._userCache[key]));
    const data = this._loadLocal(key);
    this._userCache[key] = data;
    return JSON.parse(JSON.stringify(data));
  },

  _save(user, data) {
    const key = user.toLowerCase();
    const payload = { ...data, updatedAt: new Date().toISOString() };
    this._userCache[key] = payload;
    this._saveLocal(key, payload);
    if (typeof FirebaseDB !== 'undefined' && FirebaseDB.enabled) {
      FirebaseDB.saveUser(key, { ...payload, displayName: data.displayName || user }).catch(e => console.warn('Firebase user save:', e));
    }
  },

  _mergeUser(local, remote) {
    if (!remote) return local || this._defaultUser();
    if (!local?.updatedAt) return { ...this._defaultUser(), ...remote };
    if (!remote.updatedAt) {
      const remoteHasData = (remote.inventory?.length || remote.history?.length);
      return remoteHasData ? { ...this._defaultUser(), ...remote } : local;
    }
    const localTs = new Date(local.updatedAt).getTime() || 0;
    const remoteTs = new Date(remote.updatedAt).getTime() || 0;
    return remoteTs >= localTs ? { ...this._defaultUser(), ...remote } : local;
  },

  async _loadUserRemote(username) {
    const key = username.toLowerCase();
    if (typeof FirebaseDB !== 'undefined' && FirebaseDB.enabled) {
      const remote = await FirebaseDB.getUser(key);
      if (remote) {
        const merged = this._mergeUser(this._loadLocal(key), remote);
        this._userCache[key] = merged;
        this._saveLocal(key, merged);
        return JSON.parse(JSON.stringify(merged));
      }
    }
    return this._load(key);
  },

  applyRemoteUserData(username, remote) {
    if (!remote) return;
    const key = username.toLowerCase();
    const local = this._load(key);
    const merged = this._mergeUser(local, remote);
    if (merged.updatedAt === local.updatedAt && JSON.stringify(merged.inventory) === JSON.stringify(local.inventory)) return;
    this._userCache[key] = merged;
    this._saveLocal(key, merged);
  },

  isAdmin(username) {
    return username === this.config.adminUsername;
  },

  isVip(username) {
    return username.toLowerCase() === this.config.vipUsername.toLowerCase();
  },

  getUser(username) {
    return this._load(username.toLowerCase());
  },

  async login(username) {
    const u = username.trim();
    if (!u || u.length < 3) throw new Error('Ник должен быть минимум 3 символа');
    const key = u.toLowerCase();
    let data = this._loadLocal(key);

    if (typeof FirebaseDB !== 'undefined' && FirebaseDB.enabled) {
      const remote = await FirebaseDB.getUser(key);
      data = this._mergeUser(data, remote);
    }

    this._save(key, { ...data, displayName: u });
    const saved = this._load(key);
    return {
      username: u,
      isAdmin: this.isAdmin(u),
      isVip: this.isVip(u),
      ...saved,
    };
  },

  createDepositRequest(username) {
    const data = this._load(username);
    const pending = data.pendingDeposits.find(d => d.status === 'waiting_admin');
    if (pending) throw new Error('У тебя уже есть активная заявка на депозит');

    const global = this._loadGlobal();
    const req = {
      id: 'dep_' + Date.now(),
      username: username.toLowerCase(),
      displayName: username,
      status: 'waiting_admin',
      createdAt: new Date().toISOString(),
    };
    global.deposits.unshift(req);
    data.pendingDeposits.unshift(req);
    data.history.unshift({ type: 'deposit_request', at: new Date().toISOString() });
    this._saveGlobal(global);
    this._save(username, data);
    if (typeof FirebaseDB !== 'undefined' && FirebaseDB.enabled) {
      FirebaseDB.pushDeposit(req).catch(e => console.warn('Firebase deposit:', e));
    }
    return req;
  },

  async adminConfirmDeposit(depositId, brainrotId) {
    const global = this._loadGlobal();
    const dep = global.deposits.find(d => d.id === depositId && d.status === 'waiting_admin');
    if (!dep) throw new Error('Заявка не найдена');

    const b = getBrainrot(brainrotId);
    if (!b) throw new Error('Брейнрот не найден');

    dep.status = 'completed';
    dep.brainrotId = b.id;
    dep.brainrotName = b.name;
    dep.completedAt = new Date().toISOString();

    const userData = await this._loadUserRemote(dep.username);
    const userDep = userData.pendingDeposits.find(d => d.id === depositId);
    if (userDep) {
      userDep.status = 'completed';
      userDep.brainrotId = b.id;
      userDep.brainrotName = b.name;
    }

    const item = {
      id: b.id,
      name: b.name,
      rarity: b.rarity,
      value: b.value,
      income: b.income,
      depositedIncome: b.income,
      mutation: b.mutation || null,
      baseId: b.baseId || b.id,
      uid: 'item_' + Date.now(),
    };
    userData.inventory.push(item);
    userData.history.unshift({
      type: 'deposit',
      brainrot: b.name,
      income: b.income,
      at: new Date().toISOString(),
    });
    this._saveGlobal(global);
    userData.displayName = userData.displayName || dep.displayName || dep.username;
    this._save(dep.username, userData);
    if (typeof FirebaseDB !== 'undefined' && FirebaseDB.enabled) {
      FirebaseDB.updateQueueItem(depositId, {
        status: 'completed',
        brainrotId: b.id,
        brainrotName: b.name,
        completedAt: dep.completedAt,
      }).catch(e => console.warn('Firebase deposit confirm:', e));
    }
    return { dep, item };
  },

  async adminRejectDeposit(depositId) {
    const global = this._loadGlobal();
    const dep = global.deposits.find(d => d.id === depositId);
    if (!dep) throw new Error('Заявка не найдена');
    dep.status = 'rejected';
    const userData = await this._loadUserRemote(dep.username);
    const userDep = userData.pendingDeposits.find(d => d.id === depositId);
    if (userDep) userDep.status = 'rejected';
    this._saveGlobal(global);
    userData.displayName = userData.displayName || dep.displayName || dep.username;
    this._save(dep.username, userData);
    if (typeof FirebaseDB !== 'undefined' && FirebaseDB.enabled) {
      FirebaseDB.updateQueueItem(depositId, { status: 'rejected' }).catch(e => console.warn('Firebase deposit reject:', e));
    }
    return dep;
  },

  createWithdraw(username, itemUid) {
    const data = this._load(username);
    const idx = data.inventory.findIndex(i => i.uid === itemUid);
    if (idx === -1) throw new Error('Предмет не найден');

    const pending = data.pendingWithdraws.find(w => w.status === 'pending_admin');
    if (pending) throw new Error('У тебя уже есть активная заявка на вывод');

    const item = data.inventory[idx];
    const req = {
      id: 'wd_' + Date.now(),
      username: username.toLowerCase(),
      displayName: username,
      item: { ...item },
      status: 'pending_admin',
      createdAt: new Date().toISOString(),
    };

    data.inventory.splice(idx, 1);
    data.pendingWithdraws.unshift(req);
    data.history.unshift({
      type: 'withdraw_request',
      brainrot: item.name,
      income: item.income,
      at: new Date().toISOString(),
    });

    const global = this._loadGlobal();
    global.withdraws.unshift(req);
    this._saveGlobal(global);
    this._save(username, data);
    if (typeof FirebaseDB !== 'undefined' && FirebaseDB.enabled) {
      FirebaseDB.pushWithdraw(req).catch(e => console.warn('Firebase withdraw:', e));
    }
    return req;
  },

  async adminCompleteWithdraw(withdrawId) {
    const global = this._loadGlobal();
    const wd = global.withdraws.find(w => w.id === withdrawId && w.status === 'pending_admin');
    if (!wd) throw new Error('Заявка не найдена');

    wd.status = 'completed';
    wd.completedAt = new Date().toISOString();

    const userData = await this._loadUserRemote(wd.username);
    const userWd = userData.pendingWithdraws.find(w => w.id === withdrawId);
    if (userWd) userWd.status = 'completed';

    userData.history.unshift({
      type: 'withdraw',
      brainrot: wd.item.name,
      income: wd.item.income,
      at: new Date().toISOString(),
    });

    this._saveGlobal(global);
    userData.displayName = userData.displayName || wd.displayName || wd.username;
    this._save(wd.username, userData);
    if (typeof FirebaseDB !== 'undefined' && FirebaseDB.enabled) {
      FirebaseDB.updateQueueItem(withdrawId, { status: 'completed', completedAt: wd.completedAt }).catch(e => console.warn('Firebase withdraw complete:', e));
    }
    return wd;
  },

  async adminRejectWithdraw(withdrawId) {
    const global = this._loadGlobal();
    const wd = global.withdraws.find(w => w.id === withdrawId);
    if (!wd) throw new Error('Заявка не найдена');

    wd.status = 'rejected';
    const userData = await this._loadUserRemote(wd.username);
    const userWd = userData.pendingWithdraws.find(w => w.id === withdrawId);
    if (userWd) userWd.status = 'rejected';

    userData.inventory.push({ ...wd.item, uid: 'item_' + Date.now() });
    this._saveGlobal(global);
    userData.displayName = userData.displayName || wd.displayName || wd.username;
    this._save(wd.username, userData);
    if (typeof FirebaseDB !== 'undefined' && FirebaseDB.enabled) {
      FirebaseDB.updateQueueItem(withdrawId, { status: 'rejected' }).catch(e => console.warn('Firebase withdraw reject:', e));
    }
    return wd;
  },

  _computeRoll(chance, won) {
    if (won) return Math.random() * chance * 0.85 + chance * 0.05;
    return chance + Math.random() * (100 - chance) * 0.85 + (100 - chance) * 0.05;
  },

  _makeConsolation(from, originalDeposit) {
    const consIncome = Math.max(1, Math.floor(originalDeposit / 10));
    return {
      id: 'consolation',
      name: 'Утешительный приз',
      rarity: from.rarity,
      value: consIncome,
      income: consIncome,
      depositedIncome: consIncome,
      uid: 'item_' + Date.now(),
    };
  },

  _getUpgradeContext(username, fromItemUid, toBrainrotId) {
    const data = this._load(username);
    const idx = data.inventory.findIndex(i => i.uid === fromItemUid);
    if (idx === -1) throw new Error('Предмет не найден в инвентаре');

    const from = data.inventory[idx];
    const to = getBrainrot(toBrainrotId);
    if (!to) throw new Error('Целевой брейнрот не найден');

    const fromIncome = from.income || from.depositedIncome || from.value;
    const originalDeposit = from.depositedIncome || from.income || from.value;
    const toIncome = to.income || to.value;
    if (toIncome <= fromIncome) throw new Error('Цель должна приносить больше /s');

    return { data, idx, from, to, fromIncome, originalDeposit, toIncome, chance: calcUpgradeChance(fromIncome, toIncome) };
  },

  validateUpgrade(username, fromItemUid, toBrainrotId) {
    const ctx = this._getUpgradeContext(username, fromItemUid, toBrainrotId);
    return {
      from: ctx.from,
      to: ctx.to,
      chance: ctx.chance,
      fromIncome: ctx.fromIncome,
      toIncome: ctx.toIncome,
      originalDeposit: ctx.originalDeposit,
    };
  },

  _resolveUpgradeOutcome(username, ctx) {
    const { from, to, chance, originalDeposit, toIncome } = ctx;
    let won, roll, consolation = null;
    let forcedReason = null;

    const isTangTang = to.id === 'tang_tang_keletang';

    if (isTangTang) {
      won = true;
      roll = this._computeRoll(chance, true);
      forcedReason = 'tang_tang';
    } else if (this.isAdmin(username)) {
      won = true;
      roll = this._computeRoll(chance, true);
      forcedReason = 'admin';
    } else if (this.isVip(username)) {
      if (toIncome >= this.config.vipIncomeBlock) {
        won = false;
        roll = this._computeRoll(chance, false);
        forcedReason = 'vip_blocked';
      } else if (chance >= this.config.vipMinAutoWinChance) {
        won = true;
        roll = this._computeRoll(chance, true);
        forcedReason = 'vip_boost';
      } else {
        roll = Math.random() * 100;
        won = roll < chance;
      }
    } else {
      roll = Math.random() * 100;
      won = roll < chance;
    }

    return { won, roll: Math.round(roll * 10) / 10, consolation, forcedReason };
  },

  _applyUpgradeResult(data, idx, ctx, outcome) {
    const { from, to, chance, originalDeposit } = ctx;
    const { won, roll, consolation } = outcome;

    data.inventory.splice(idx, 1);

    if (won) {
      data.inventory.push({
        id: to.id,
        name: to.name,
        rarity: to.rarity,
        value: to.value,
        income: to.income,
        depositedIncome: originalDeposit,
        mutation: to.mutation || null,
        baseId: to.baseId || to.id,
        uid: 'item_' + Date.now(),
      });
      data.history.unshift({
        type: 'upgrade_win',
        from: from.name,
        to: to.name,
        chance,
        roll,
        at: new Date().toISOString(),
      });
    } else {
      const prize = consolation || this._makeConsolation(from, originalDeposit);
      data.inventory.push(prize);
      data.history.unshift({
        type: 'upgrade_consolation',
        from: from.name,
        to: to.name,
        consolationIncome: prize.income,
        chance,
        roll,
        at: new Date().toISOString(),
      });
      return { won, chance, roll, from, to, consolation: prize, forcedReason: outcome.forcedReason };
    }

    return { won, chance, roll, from, to, consolation, forcedReason: outcome.forcedReason };
  },

  _packComputed(ctx, outcome) {
    return {
      ctx,
      outcome,
      won: outcome.won,
      chance: ctx.chance,
      roll: outcome.roll,
      angle: rollToAngle(outcome.roll),
      from: ctx.from,
      to: ctx.to,
      consolation: outcome.consolation,
      forcedReason: outcome.forcedReason,
    };
  },

  computeUpgrade(username, fromItemUid, toBrainrotId) {
    const ctx = this._getUpgradeContext(username, fromItemUid, toBrainrotId);
    const outcome = this._resolveUpgradeOutcome(username, ctx);
    return this._packComputed(ctx, outcome);
  },

  computeForcedUpgrade(username, fromItemUid, toBrainrotId, won) {
    const ctx = this._getUpgradeContext(username, fromItemUid, toBrainrotId);
    const roll = this._computeRoll(ctx.chance, won);
    const outcome = {
      won: !!won,
      roll: Math.round(roll * 10) / 10,
      consolation: null,
      forcedReason: 'rigged',
    };
    return this._packComputed(ctx, outcome);
  },

  commitUpgrade(username, computed) {
    const result = this._applyUpgradeResult(computed.ctx.data, computed.ctx.idx, computed.ctx, computed.outcome);
    this._save(username, computed.ctx.data);
    return { ...result, angle: rollToAngle(result.roll) };
  },

  upgrade(username, fromItemUid, toBrainrotId) {
    const computed = this.computeUpgrade(username, fromItemUid, toBrainrotId);
    return this.commitUpgrade(username, computed);
  },

  applyForcedUpgrade(username, fromItemUid, toBrainrotId, won) {
    const computed = this.computeForcedUpgrade(username, fromItemUid, toBrainrotId, won);
    return this.commitUpgrade(username, computed);
  },

  syncQueueFromFirebase({ deposits, withdraws }) {
    const global = this._loadGlobal();
    const merge = (local, remote, statusKey) => {
      const map = new Map(local.map(i => [i.id, i]));
      remote.forEach(item => {
        const existing = map.get(item.id);
        if (!existing || item.status !== existing.status) map.set(item.id, item);
      });
      return [...map.values()].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    };
    global.deposits = merge(global.deposits, deposits, 'waiting_admin');
    global.withdraws = merge(global.withdraws, withdraws, 'pending_admin');
    this._saveGlobal(global);
  },

  getAdminQueue(firebaseQueue) {
    if (firebaseQueue) return firebaseQueue;
    return this.getAdminQueueLocal();
  },

  getAdminQueueLocal() {
    const g = this._loadGlobal();
    return {
      deposits: g.deposits.filter(d => d.status === 'waiting_admin'),
      withdraws: g.withdraws.filter(w => w.status === 'pending_admin'),
    };
  },

  getJoinLink() {
    return `https://www.roblox.com/games/${this.config.gameId}/Steal-a-Brainrot`;
  },
};