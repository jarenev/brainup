let currentUser = null;
let selectedFrom = null;
let selectedTo = null;
let isSpinning = false;
let upgradeSearch = '';
let arrowRotation = 0;
let filterMult = null;
let filterChance = null;
const DEFAULT_FILTER_MULTS = [2, 4, 8];
const DEFAULT_FILTER_CHANCES = [35, 55, 75];
let filterMutation = '';
let fastSpin = false;
let targetPage = 1;
const TARGETS_PER_PAGE = 18;
let firebaseQueue = null;
let riggedPlayers = [];
let pendingSpins = [];
let firebaseUnsubs = [];
let wheelDisplayLock = null;

function $(sel) { return document.querySelector(sel); }
function $$(sel) { return document.querySelectorAll(sel); }

function showToast(msg, type = 'success') {
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 4000);
}

function itemIncome(item) {
  const cat = getBrainrot(item.id);
  return item.income || cat?.income || item.depositedIncome || item.value || 0;
}

function filterTargetsByMult(targets, fromInc, mult) {
  const minInc = fromInc * mult;
  return targets
    .filter(b => b.income >= minInc)
    .sort((a, b) => a.income - b.income);
}

function filterTargetsByChance(targets, fromInc, maxChance) {
  return targets
    .map(b => ({ b, ch: calcUpgradeChance(fromInc, b.income) }))
    .filter(({ ch }) => ch <= maxChance)
    .sort((a, b) => a.b.income - b.b.income)
    .map(({ b, ch }) => ({ ...b, _chance: ch }));
}

function minIncomeForChance(fromInc, chancePct) {
  return fromInc / (chancePct / 100 / 0.85);
}

function mutationBadgeHtml(mutation) {
  if (!mutation) return '';
  const m = getMutationInfo(mutation);
  const color = m?.color || '#888';
  return `<span class="mutation-badge" style="background:${color}33;color:${color}">${mutation}</span>`;
}

function brainrotCardHtml(b, opts = {}) {
  const r = getRarityInfo(b.rarity);
  const income = opts.income != null ? opts.income : (b.income ?? itemIncome(b));
  const sel = opts.selected ? ' selected' : '';
  const onclick = opts.onclick ? ` onclick="${opts.onclick}"` : '';
  const uid = opts.uid ? ` data-uid="${opts.uid}"` : '';
  const chanceLine = opts.chance != null
    ? `<div class="brainrot-chance">${formatChance(opts.chance)}</div>` : '';
  const mut = b.mutation || opts.mutation;
  return `<div class="brainrot-card${sel}" data-id="${b.id}"${uid}${onclick}>
    <div class="brainrot-name">${b.name}</div>
    <div class="brainrot-badges">${mutationBadgeHtml(mut)}<span class="rarity-badge" style="background:${r.color}22;color:${r.color}">${b.rarity}</span></div>
    <div class="brainrot-income">${formatIncome(income)}/s</div>
    ${chanceLine}
    ${opts.extra || ''}
  </div>`;
}

function renderTargetPagination(total) {
  const el = $('#target-pagination');
  if (!el) return;
  const pages = Math.ceil(total / TARGETS_PER_PAGE);
  if (pages <= 1) { el.innerHTML = ''; return; }

  let html = `<button class="page-btn" ${targetPage <= 1 ? 'disabled' : ''} onclick="goTargetPage(${targetPage - 1})">‹</button>`;
  for (let i = 1; i <= pages; i++) {
    if (pages > 7 && i !== 1 && i !== pages && Math.abs(i - targetPage) > 1) {
      if (i === 2 || i === pages - 1) html += `<span class="page-dots">…</span>`;
      continue;
    }
    html += `<button class="page-btn${i === targetPage ? ' active' : ''}" onclick="goTargetPage(${i})">${i}</button>`;
  }
  html += `<button class="page-btn" ${targetPage >= pages ? 'disabled' : ''} onclick="goTargetPage(${targetPage + 1})">›</button>`;
  html += `<span class="page-info">${targetPage}/${pages}</span>`;
  el.innerHTML = html;
}

window.goTargetPage = function(p) {
  targetPage = Math.max(1, p);
  renderUpgradeSelectors();
};

function loadFilterConfig() {
  try {
    const m = JSON.parse(localStorage.getItem('brainrotup_filter_mults'));
    const c = JSON.parse(localStorage.getItem('brainrotup_filter_chances'));
    return {
      mults: Array.isArray(m) && m.length ? m.map(Number).filter(n => n > 0) : [...DEFAULT_FILTER_MULTS],
      chances: Array.isArray(c) && c.length ? c.map(Number).filter(n => n > 0) : [...DEFAULT_FILTER_CHANCES],
    };
  } catch {
    return { mults: [...DEFAULT_FILTER_MULTS], chances: [...DEFAULT_FILTER_CHANCES] };
  }
}

function parseFilterList(str, fallback) {
  const vals = String(str || '')
    .split(/[,;\s]+/)
    .map(s => parseFloat(s.trim()))
    .filter(n => !isNaN(n) && n > 0);
  return vals.length ? vals : fallback;
}

function formatMultLabel(v) {
  return Number.isInteger(v) ? v : parseFloat(v.toFixed(2));
}

function filterValueMatch(a, b) {
  return Math.abs(Number(a) - Number(b)) < 1e-12;
}

function renderFilterButtons() {
  const cfg = loadFilterConfig();
  const multRow = $('#filter-mult-row');
  const chanceRow = $('#filter-chance-row');
  if (!multRow || !chanceRow) return;

  multRow.innerHTML = cfg.mults.map(v => {
    const active = filterMult != null && filterValueMatch(filterMult, v);
    return `<button type="button" class="filter-btn${active ? ' active' : ''}" data-filter="mult" data-value="${v}">x${formatMultLabel(v)}</button>`;
  }).join('');

  chanceRow.innerHTML = cfg.chances.map(v => {
    const active = filterChance != null && filterValueMatch(filterChance, v);
    return `<button type="button" class="filter-btn${active ? ' active' : ''}" data-filter="chance" data-value="${v}">${formatChanceShort(v)}</button>`;
  }).join('');
}

function initFilterButtons() {
  renderFilterButtons();

  $('#filter-settings-toggle')?.addEventListener('click', () => {
    const panel = $('#filter-settings-panel');
    if (!panel) return;
    const open = panel.style.display === 'none';
    if (open) {
      const cfg = loadFilterConfig();
      $('#filter-mult-input').value = cfg.mults.join(', ');
      $('#filter-chance-input').value = cfg.chances.join(', ');
    }
    panel.style.display = open ? '' : 'none';
  });

  $('#filter-save-btn')?.addEventListener('click', () => {
    const mults = parseFilterList($('#filter-mult-input')?.value, DEFAULT_FILTER_MULTS);
    const chances = parseFilterList($('#filter-chance-input')?.value, DEFAULT_FILTER_CHANCES);
    localStorage.setItem('brainrotup_filter_mults', JSON.stringify(mults));
    localStorage.setItem('brainrotup_filter_chances', JSON.stringify(chances));
    filterMult = null;
    filterChance = null;
    renderFilterButtons();
    renderUpgradeSelectors();
    $('#filter-settings-panel').style.display = 'none';
    showToast('Кнопки фильтров сохранены');
  });

  $('#filter-group')?.addEventListener('click', e => {
    const btn = e.target.closest('.filter-btn');
    if (!btn) return;

    const type = btn.dataset.filter;
    const val = parseFloat(btn.dataset.value);
    const row = btn.parentElement;
    const wasActive = btn.classList.contains('active');

    row.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
    targetPage = 1;

    if (wasActive) {
      if (type === 'mult') filterMult = null;
      else filterChance = null;
    } else {
      btn.classList.add('active');
      if (type === 'mult') {
        filterMult = val;
        filterChance = null;
        $('#filter-chance-row')?.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
      } else {
        filterChance = val;
        filterMult = null;
        $('#filter-mult-row')?.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
      }
    }
    renderUpgradeSelectors();
  });
}

function initMutationFilter() {
  const sel = $('#mutation-filter');
  if (!sel) return;
  const muts = Object.keys(MUTATIONS).filter(k => k !== 'Default');
  sel.innerHTML = '<option value="">Все мутации</option><option value="_base_">Без мутации</option>'
    + muts.map(m => `<option value="${m}">${m}</option>`).join('');
  sel.addEventListener('change', e => {
    filterMutation = e.target.value;
    targetPage = 1;
    renderUpgradeSelectors();
  });
}

async function boot() {
  try {
    await loadBrainrots();
    initMutationFilter();
    initFilterButtons();
    const fbOk = typeof FirebaseDB !== 'undefined' && FirebaseDB.init();
    updateFirebaseStatus(fbOk);
    $('#loading-screen').style.display = 'none';
    initLogin();
  } catch (e) {
    $('#loading-screen').innerHTML = `<p style="color:#ef4444">Ошибка загрузки каталога: ${e.message}</p>`;
  }
}

function updateFirebaseStatus(connected) {
  const el = $('#firebase-status');
  if (!el) return;
  if (connected) {
    el.textContent = 'Firebase: подключён — инвентарь, очередь и подкрутка синхронизируются';
    el.className = 'firebase-status online';
  } else {
    el.textContent = 'Firebase: не подключён — укажи apiKey и databaseURL в js/firebase-config.js';
    el.className = 'firebase-status offline';
  }
}

function teardownFirebase() {
  firebaseUnsubs.forEach(fn => fn?.());
  firebaseUnsubs = [];
}

function initFirebaseSubscriptions() {
  teardownFirebase();
  if (!FirebaseDB.enabled || !currentUser) return;

  firebaseUnsubs.push(FirebaseDB.subscribeUser(currentUser.username, data => {
    if (!data) return;
    API.applyRemoteUserData(currentUser.username, data);
    if (!isSpinning) refreshUI();
    else updateChance();
  }));

  if (!currentUser.isAdmin) return;

  firebaseUnsubs.push(FirebaseDB.subscribeQueue(data => {
    firebaseQueue = data;
    API.syncQueueFromFirebase(data);
    renderAdminPanel();
  }));

  firebaseUnsubs.push(FirebaseDB.subscribeRiggedPlayers(list => {
    riggedPlayers = list.filter(p => p.enabled);
    renderRiggedList();
    renderAdminPanel();
  }));

  firebaseUnsubs.push(FirebaseDB.subscribePendingSpins(list => {
    pendingSpins = list;
    renderPendingSpins();
    renderAdminPanel();
  }));
}

function lockWheelDisplay() {
  const fromItem = currentUser?.inventory.find(i => i.uid === selectedFrom);
  const toB = selectedTo ? getBrainrot(selectedTo) : null;
  if (!fromItem || !toB) return;
  const chance = calcUpgradeChance(itemIncome(fromItem), toB.income);
  wheelDisplayLock = { chance, deg: chanceToWheelDeg(chance) };
}

function setWheelLag(active) {
  const container = $('.wheel-container');
  const chanceEl = $('#chance-display');
  if (!container) return;
  container.classList.toggle('wheel-lagging', active);
  if (active) {
    chanceEl.textContent = '···';
  } else {
    updateChance();
  }
}

async function initLogin() {
  const saved = localStorage.getItem('brainrotup_current');
  if (saved) {
    try {
      currentUser = await API.login(saved);
      showApp();
      return;
    } catch { localStorage.removeItem('brainrotup_current'); }
  }
  $('#login-screen').style.display = 'flex';

  $('#login-btn').addEventListener('click', async () => {
    const name = $('#username-input').value.trim();
    const btn = $('#login-btn');
    btn.disabled = true;
    try {
      currentUser = await API.login(name);
      localStorage.setItem('brainrotup_current', name);
      showApp();
    } catch (e) { showToast(e.message, 'error'); }
    btn.disabled = false;
  });

  $('#username-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') $('#login-btn').click();
  });
}

function showApp() {
  $('#login-screen').style.display = 'none';
  $('#app').style.display = 'block';

  if (currentUser.isAdmin) {
    $('#admin-nav').style.display = '';
    $('#role-badge').style.display = '';
    $('#role-badge').textContent = 'ADMIN';
    $('#role-badge').className = 'role-badge admin';
  }

  initFirebaseSubscriptions();
  refreshUI();
}

function refreshUI() {
  if (!currentUser) return;
  const data = API.getUser(currentUser.username);
  currentUser = { ...currentUser, ...data };

  $('#user-display').textContent = currentUser.username;
  renderInventory();
  renderHistory();
  renderUpgradeSelectors();
  renderDepositStatus();
  renderWithdrawStatus();
  if (currentUser.isAdmin) renderAdminPanel();
}

function renderInventory() {
  const el = $('#inventory-grid');
  const count = currentUser.inventory.length;
  $('#inventory-count').textContent = count ? `${count} предмет(ов)` : 'Пусто';

  if (!count) {
    el.innerHTML = `<div class="empty-state" style="grid-column:1/-1">
      <div class="emoji">📦</div><p>Инвентарь пуст. Подай заявку на депозит!</p></div>`;
    return;
  }
  el.innerHTML = currentUser.inventory.map(item => {
    const b = { ...(getBrainrot(item.id) || {}), ...item };
    return brainrotCardHtml(b, {
      uid: item.uid,
      income: itemIncome(item),
      onclick: `selectFromItem('${item.uid}')`,
    });
  }).join('');
}

function renderHistory() {
  const el = $('#history-list');
  if (!currentUser.history.length) {
    el.innerHTML = '<div class="empty-state"><p>История пуста</p></div>';
    return;
  }
  el.innerHTML = currentUser.history.slice(0, 25).map(h => {
    let cls = 'neutral', text = '';
    const t = new Date(h.at).toLocaleTimeString('ru');
    if (h.type === 'upgrade_win') cls = 'win', text = `✅ ${h.from} → ${h.to} (${formatChance(h.chance)}, roll ${h.roll})`;
    else if (h.type === 'upgrade_lose') cls = 'lose', text = `❌ ${h.from} → ${h.to} (${formatChance(h.chance)}, roll ${h.roll})`;
    else if (h.type === 'upgrade_consolation') cls = 'win', text = `🎁 Утешительный: ${formatIncome(h.consolationIncome)}/s (${formatChance(h.chance)})`;
    else if (h.type === 'deposit') cls = 'win', text = `📥 Депозит: ${h.brainrot} (${formatIncome(h.income)}/s)`;
    else if (h.type === 'deposit_request') cls = 'neutral', text = `📋 Заявка на депозит отправлена`;
    else if (h.type === 'withdraw') cls = 'neutral', text = `📤 Вывод: ${h.brainrot} (${formatIncome(h.income)}/s)`;
    else if (h.type === 'withdraw_request') cls = 'neutral', text = `📋 Заявка на вывод: ${h.brainrot}`;
    return `<div class="history-item ${cls}"><span>${text}</span><span class="hist-time">${t}</span></div>`;
  }).join('');
}

function renderUpgradeSelectors() {
  const fromEl = $('#upgrade-from-grid');
  const toEl = $('#upgrade-to-grid');

  fromEl.innerHTML = currentUser.inventory.map(item => {
    const b = { ...(getBrainrot(item.id) || {}), ...item };
    return brainrotCardHtml(b, {
      uid: item.uid,
      income: itemIncome(item),
      selected: selectedFrom === item.uid,
      onclick: `selectFromItem('${item.uid}')`,
    });
  }).join('') || '<div class="empty-state"><p>Нет предметов</p></div>';

  const fromItem = currentUser.inventory.find(i => i.uid === selectedFrom);
  const fromInc = fromItem ? itemIncome(fromItem) : 0;
  const q = upgradeSearch.toLowerCase();

  let emptyMsg = '<div class="empty-state"><p>Выбери предмет слева</p></div>';

  if ((filterMult || filterChance) && !fromInc) {
    emptyMsg = '<div class="empty-state"><p>Сначала выбери предмет слева</p></div>';
  } else {
    let pool = BRAINROTS.filter(b => {
      const inc = b.income || 0;
      if (!fromInc || inc <= fromInc) return false;
      if (filterMutation === '_base_' && b.mutation) return false;
      if (filterMutation && filterMutation !== '_base_' && b.mutation !== filterMutation) return false;
      if (q && !b.name.toLowerCase().includes(q) && !b.rarity.toLowerCase().includes(q)
          && !(b.mutation && b.mutation.toLowerCase().includes(q))) return false;
      return true;
    });

    let showChance = false;

    if (filterMult && fromInc) {
      pool = filterTargetsByMult(pool, fromInc, filterMult);
      emptyMsg = `<div class="empty-state"><p>Нет целей от ${formatIncome(fromInc * filterMult)}/s</p></div>`;
    } else if (filterChance && fromInc) {
      pool = filterTargetsByChance(pool, fromInc, filterChance);
      showChance = true;
      emptyMsg = `<div class="empty-state"><p>Нет целей со шансом до ${formatChance(filterChance)}</p></div>`;
    } else {
      pool.sort((a, b) => a.income - b.income);
      emptyMsg = '<div class="empty-state"><p>Выбери предмет или измени поиск</p></div>';
    }

    const total = pool.length;
    const maxPage = Math.max(1, Math.ceil(total / TARGETS_PER_PAGE));
    if (targetPage > maxPage) targetPage = maxPage;

    const pageItems = pool.slice((targetPage - 1) * TARGETS_PER_PAGE, targetPage * TARGETS_PER_PAGE);

    toEl.innerHTML = pageItems.map(b => {
      const ch = b._chance ?? (fromInc ? calcUpgradeChance(fromInc, b.income) : null);
      return brainrotCardHtml(b, {
        selected: selectedTo === b.id,
        onclick: `selectToItem('${b.id}')`,
        chance: showChance || filterChance ? ch : null,
      });
    }).join('') || emptyMsg;

    renderTargetPagination(total);
  }

  if ((filterMult || filterChance) && !fromInc) {
    toEl.innerHTML = emptyMsg;
    renderTargetPagination(0);
  }

  const hintEl = $('#filter-hint');
  if (hintEl) {
    if (filterMult && fromInc) {
      hintEl.textContent = `от ${formatIncome(fromInc * filterMult)}/s и выше (x${filterMult}+)`;
    } else if (filterChance && fromInc) {
      const minInc = minIncomeForChance(fromInc, filterChance);
      hintEl.textContent = `шанс до ${formatChance(filterChance)} · от ${formatIncome(minInc)}/s и рискованнее`;
    } else {
      hintEl.textContent = '';
    }
  }

  updateChance();
  updatePreview();
}

window.selectFromItem = function(uid) {
  selectedFrom = uid;
  selectedTo = null;
  targetPage = 1;
  renderUpgradeSelectors();
};

window.selectToItem = function(id) {
  selectedTo = id;
  renderUpgradeSelectors();
};

function updatePreview() {
  const el = $('#upgrade-preview');
  const fromItem = currentUser.inventory.find(i => i.uid === selectedFrom);
  const toB = selectedTo ? getBrainrot(selectedTo) : null;
  if (!fromItem || !toB) { el.innerHTML = ''; return; }

  const fromInc = itemIncome(fromItem);
  const chance = calcUpgradeChance(fromInc, toB.income);

  el.innerHTML = `<div class="preview-row">
    <span>${fromItem.name}</span><span class="preview-arrow">→</span><span>${toB.name}</span>
  </div>
  <div class="preview-stats">${formatIncome(fromInc)}/s → ${formatIncome(toB.income)}/s · ${formatChance(chance)}</div>`;
}

function updateChance() {
  const chanceEl = $('#chance-display');
  const wheel = $('#wheel');
  const btn = $('#upgrade-btn');

  if (wheelDisplayLock) {
    const lagging = $('.wheel-container')?.classList.contains('wheel-lagging');
    chanceEl.textContent = lagging ? '···' : formatChance(wheelDisplayLock.chance);
    wheel.style.setProperty('--chance-deg', wheelDisplayLock.deg);
    btn.disabled = true;
    return;
  }

  const fromItem = currentUser.inventory.find(i => i.uid === selectedFrom);
  const toB = selectedTo ? getBrainrot(selectedTo) : null;

  if (!fromItem || !toB) {
    chanceEl.textContent = '—';
    wheel.style.setProperty('--chance-deg', '0deg');
    btn.disabled = true;
    return;
  }

  const chance = calcUpgradeChance(itemIncome(fromItem), toB.income);
  chanceEl.textContent = formatChance(chance);
  wheel.style.setProperty('--chance-deg', chanceToWheelDeg(chance));
  btn.disabled = isSpinning;
}

function spinArrowToRoll(roll, duration = 4000) {
  return new Promise(resolve => {
    const arrow = $('#wheel-arrow');
    const targetMod = rollToAngle(roll);
    const currentMod = ((arrowRotation % 360) + 360) % 360;
    let delta = targetMod - currentMod;
    if (delta <= 0) delta += 360;
    const spins = 5 + Math.floor(Math.random() * 2);
    arrowRotation = arrowRotation + spins * 360 + delta;

    arrow.style.transition = `transform ${duration}ms cubic-bezier(0.12, 0.8, 0.2, 1)`;
    arrow.style.transform = `rotate(${arrowRotation}deg)`;
    setTimeout(resolve, duration + 100);
  });
}

async function doUpgrade() {
  if (isSpinning || !selectedFrom || !selectedTo) return;
  isSpinning = true;
  $('#upgrade-btn').disabled = true;
  lockWheelDisplay();

  let computed;
  try {
    const validated = API.validateUpgrade(currentUser.username, selectedFrom, selectedTo);

    const rigged = typeof FirebaseDB !== 'undefined'
      && FirebaseDB.enabled
      && !currentUser.isAdmin
      && await FirebaseDB.isRigged(currentUser.username);

    if (rigged) {
      setWheelLag(true);

      const spinId = await FirebaseDB.createPendingSpin({
        displayName: currentUser.username,
        fromItemUid: selectedFrom,
        toBrainrotId: selectedTo,
        fromName: validated.from.name,
        toName: validated.to.name,
        fromIncome: validated.fromIncome,
        toIncome: validated.toIncome,
        chance: validated.chance,
      });

      let spinData;
      try {
        spinData = await FirebaseDB.waitForSpinResult(spinId, 5000);
      } catch (e) {
        setWheelLag(false);
        wheelDisplayLock = null;
        showToast('Прокрутка не удалась, попробуй снова', 'error');
        isSpinning = false;
        updateChance();
        return;
      }

      setWheelLag(false);
      computed = API.computeForcedUpgrade(
        currentUser.username, selectedFrom, selectedTo, spinData.result === 'win'
      );
    } else {
      computed = API.computeUpgrade(currentUser.username, selectedFrom, selectedTo);
    }
  } catch (e) {
    setWheelLag(false);
    wheelDisplayLock = null;
    showToast(e.message, 'error');
    isSpinning = false;
    updateChance();
    return;
  }

  await spinArrowToRoll(computed.roll, fastSpin ? 700 : 4000);

  let result;
  try {
    result = API.commitUpgrade(currentUser.username, computed);
  } catch (e) {
    wheelDisplayLock = null;
    isSpinning = false;
    showToast(e.message, 'error');
    updateChance();
    return;
  }

  wheelDisplayLock = null;
  showResultModal(result);
  selectedFrom = null;
  selectedTo = null;
  refreshUI();
  isSpinning = false;
}

function showResultModal(result) {
  const modal = $('#result-modal');
  const title = $('#result-title');
  const emoji = $('#result-emoji');
  const desc = $('#result-desc');

  if (result.won) {
    title.textContent = 'ПОБЕДА!';
    title.style.color = 'var(--success)';
    emoji.textContent = '🎉';
    desc.textContent = `Получен ${result.to.name} (${formatIncome(result.to.income)}/s)! Roll: ${result.roll} при шансе ${formatChance(result.chance)}`;
  } else {
    title.textContent = 'КОМПЕНСАЦИЯ';
    title.style.color = 'var(--cyan)';
    emoji.textContent = '🎁';
    const prize = result.consolation?.income ?? 0;
    desc.textContent = `Не зашло на ${result.to.name}. Компенсация: ${formatIncome(prize)}/s (1/10 от депозита). Roll: ${result.roll}`;
  }
  modal.classList.add('open');
}

function renderDepositStatus() {
  const el = $('#pending-deposits');
  const deps = currentUser.pendingDeposits.filter(d => d.status === 'waiting_admin');
  if (!deps.length) { el.innerHTML = ''; return; }
  el.innerHTML = deps.map(d => `<div class="pending-card">
    <span class="status-pill waiting">Ожидание админа</span>
    <p>Заявка от ${new Date(d.createdAt).toLocaleString('ru')}</p>
    <p class="pending-hint">Зайди в игру и прими трейд от бота</p>
  </div>`).join('');
}

function renderWithdrawStatus() {
  const el = $('#pending-withdraws');
  if (!el) return;
  const wds = currentUser.pendingWithdraws.filter(w => w.status === 'pending_admin');
  if (!wds.length) { el.innerHTML = ''; return; }
  el.innerHTML = wds.map(w => `<div class="pending-card">
    <span class="status-pill processing">Вывод в обработке</span>
    <p><strong>${w.item.name}</strong> (${formatIncome(w.item.income)}/s)</p>
    <p class="pending-hint">Зайди в игру и жди трейд от бота</p>
  </div>`).join('');
}

function renderRiggedList() {
  const el = $('#admin-rigged-list');
  if (!el) return;
  if (typeof FirebaseDB === 'undefined' || !FirebaseDB.enabled) {
    el.innerHTML = '<div class="empty-state"><p>Подключи Firebase (docs/FIREBASE.md)</p></div>';
    return;
  }
  if (!riggedPlayers.length) {
    el.innerHTML = '<div class="empty-state"><p>Никого с подкруткой</p></div>';
    return;
  }
  el.innerHTML = riggedPlayers.map(p => `<div class="admin-card">
    <div class="admin-card-head">
      <strong>${p.displayName || p.id}</strong>
      <span class="rigged-tag">подкрутка</span>
    </div>
    <div class="admin-actions">
      <button class="btn btn-danger btn-sm" onclick="adminDisableRig('${escapeAttr(p.displayName || p.id)}')">Выключить</button>
    </div>
  </div>`).join('');
}

function spinIncomeVal(s, which) {
  if (which === 'from') {
    if (s.fromIncome != null) return s.fromIncome;
    const b = getBrainrotByName(s.fromName);
    return b?.income ?? null;
  }
  if (s.toIncome != null) return s.toIncome;
  return getBrainrot(s.toBrainrotId)?.income ?? getBrainrotByName(s.toName)?.income ?? null;
}

function renderPendingSpins() {
  const el = $('#admin-pending-spins');
  const badge = $('#admin-spin-count');
  if (!el) return;

  if (typeof FirebaseDB === 'undefined' || !FirebaseDB.enabled) {
    if (badge) badge.style.display = 'none';
    el.innerHTML = '<div class="empty-state"><p>Подключи Firebase для подкрутки</p></div>';
    return;
  }

  const count = pendingSpins.length;
  if (badge) {
    badge.textContent = count;
    badge.style.display = count ? '' : 'none';
  }

  if (!count) {
    el.innerHTML = '<div class="empty-state"><p>Нет активных прокруток</p></div>';
    return;
  }

  el.innerHTML = pendingSpins.map(s => `<div class="admin-card spin-card" id="spin-${s.id}">
    <div class="admin-card-head">
      <strong>${s.displayName || s.username}</strong>
      <span class="hist-time">${formatChance(s.chance)}</span>
    </div>
    <p>${s.fromName} <span class="admin-income">${formatIncome(spinIncomeVal(s, 'from'))}/s</span>
      → <strong>${s.toName}</strong> <span class="admin-income">${formatIncome(spinIncomeVal(s, 'to'))}/s</span></p>
    <p class="admin-hint">Игрок крутит — выбери результат</p>
    <div class="admin-actions">
      <button class="btn btn-primary" onclick="adminResolveSpin('${s.id}', 'win')">Заход</button>
      <button class="btn btn-danger" onclick="adminResolveSpin('${s.id}', 'lose')">Незаход</button>
    </div>
  </div>`).join('');
}

function escapeAttr(str) {
  return String(str).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function renderAdminPanel() {
  const useFbQueue = typeof FirebaseDB !== 'undefined' && FirebaseDB.enabled && firebaseQueue;
  const queue = API.getAdminQueue(useFbQueue ? firebaseQueue : null);
  const depCount = queue.deposits.length;
  const wdCount = queue.withdraws.length;
  const spinCount = pendingSpins.length;

  $('#admin-badge').textContent = depCount + wdCount + spinCount;
  $('#admin-badge').style.display = depCount + wdCount + spinCount ? '' : 'none';
  $('#admin-dep-count').textContent = depCount;
  $('#admin-wd-count').textContent = wdCount;

  const depEl = $('#admin-deposits');
  if (!depCount) {
    depEl.innerHTML = '<div class="empty-state"><p>Нет заявок</p></div>';
  } else {
    const datalistOpts = BRAINROTS.map(b =>
      `<option value="${b.name}">${formatIncome(b.income)}/s · ${b.rarity}</option>`
    ).join('');
    depEl.innerHTML = queue.deposits.map(d => `<div class="admin-card" id="admin-dep-${d.id}">
        <div class="admin-card-head">
          <strong>${d.displayName || d.username}</strong>
          <span class="hist-time">${new Date(d.createdAt).toLocaleString('ru')}</span>
        </div>
        <p class="admin-hint">Игрок отдал брейнрота в трейде — введи название:</p>
        <input class="input" id="input-${d.id}" list="brainrot-datalist" placeholder="Например: Noobini Pizzanini">
        <datalist id="brainrot-datalist">${datalistOpts}</datalist>
        <div class="admin-actions">
          <button class="btn btn-primary" onclick="adminConfirmDep('${d.id}')">Зачислить</button>
          <button class="btn btn-danger" onclick="adminRejectDep('${d.id}')">Отклонить</button>
        </div>
      </div>`).join('');
  }

  const wdEl = $('#admin-withdraws');
  if (!wdCount) {
    wdEl.innerHTML = '<div class="empty-state"><p>Нет заявок</p></div>';
  } else {
    wdEl.innerHTML = queue.withdraws.map(w => `<div class="admin-card">
      <div class="admin-card-head">
        <strong>${w.displayName || w.username}</strong>
        <span class="hist-time">${new Date(w.createdAt).toLocaleString('ru')}</span>
      </div>
      <p>Вывод: <strong>${w.item.name}</strong></p>
      <p>${formatIncome(w.item.income)}/s · ${w.item.rarity}</p>
      <p class="admin-hint">Отправь трейд в игре, затем подтверди:</p>
      <div class="admin-actions">
        <button class="btn btn-primary" onclick="adminCompleteWd('${w.id}')">Трейд отправлен</button>
        <button class="btn btn-danger" onclick="adminRejectWd('${w.id}')">Отклонить</button>
      </div>
    </div>`).join('');
  }

  renderRiggedList();
  renderPendingSpins();
}

window.adminEnableRig = async function() {
  const name = $('#rig-username-input')?.value.trim();
  if (!name || name.length < 3) { showToast('Введи ник игрока (мин. 3 символа)', 'error'); return; }
  if (!FirebaseDB.enabled) { showToast('Firebase не подключён', 'error'); return; }
  try {
    await FirebaseDB.setRigged(name, true);
    showToast(`Подкрутка включена: ${name}`);
    $('#rig-username-input').value = '';
  } catch (e) { showToast(e.message, 'error'); }
};

window.adminDisableRig = async function(name) {
  if (!FirebaseDB.enabled) { showToast('Firebase не подключён', 'error'); return; }
  try {
    await FirebaseDB.setRigged(name, false);
    showToast(`Подкрутка выключена: ${name}`, 'error');
  } catch (e) { showToast(e.message, 'error'); }
};

window.adminResolveSpin = async function(spinId, result) {
  if (!FirebaseDB.enabled) { showToast('Firebase не подключён', 'error'); return; }
  try {
    await FirebaseDB.resolveSpin(spinId, result);
    showToast(result === 'win' ? 'Заход подтверждён' : 'Незаход подтверждён');
  } catch (e) { showToast(e.message, 'error'); }
};

window.adminConfirmDep = async function(id) {
  const name = $(`#input-${id}`).value.trim();
  const b = getBrainrotByName(name);
  if (!b) { showToast('Брейнрот не найден. Проверь название.', 'error'); return; }
  try {
    await API.adminConfirmDeposit(id, b.id);
    showToast(`Зачислен: ${b.name}`);
    refreshUI();
  } catch (e) { showToast(e.message, 'error'); }
};

window.adminRejectDep = async function(id) {
  try {
    await API.adminRejectDeposit(id);
    showToast('Заявка отклонена', 'error');
    refreshUI();
  } catch (e) { showToast(e.message, 'error'); }
};

window.adminCompleteWd = async function(id) {
  try {
    await API.adminCompleteWithdraw(id);
    showToast('Вывод подтверждён!');
    refreshUI();
  } catch (e) { showToast(e.message, 'error'); }
};

window.adminRejectWd = async function(id) {
  try {
    await API.adminRejectWithdraw(id);
    showToast('Вывод отклонён, предмет возвращён', 'error');
    refreshUI();
  } catch (e) { showToast(e.message, 'error'); }
};

function initDeposit() {
  $('#deposit-btn').addEventListener('click', () => {
    try {
      API.createDepositRequest(currentUser.username);
      showToast('Заявка создана! Зайди в игру.');
      refreshUI();
    } catch (e) { showToast(e.message, 'error'); }
  });
  $('#join-link').href = API.getJoinLink();
}

function renderWithdrawList() {
  const el = $('#withdraw-list');
  if (!currentUser || !currentUser.inventory.length) {
    el.innerHTML = '<div class="empty-state"><p>Нечего выводить</p></div>';
    return;
  }
  el.innerHTML = currentUser.inventory.map(item => {
    const b = { ...(getBrainrot(item.id) || {}), ...item };
    return brainrotCardHtml(b, {
      extra: `<button class="btn btn-primary btn-sm" onclick="doWithdraw('${item.uid}')">Вывести</button>`,
    });
  }).join('');
  renderWithdrawStatus();
}

function initWithdraw() {
  window.doWithdraw = function(uid) {
    try {
      API.createWithdraw(currentUser.username, uid);
      showToast('Заявка на вывод! Зайди в игру.');
      refreshUI();
      renderWithdrawList();
    } catch (e) { showToast(e.message, 'error'); }
  };
}

function initNav() {
  $$('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      $$('.nav-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      $$('.page').forEach(p => p.classList.remove('active'));
      $(`#page-${btn.dataset.page}`).classList.add('active');
      if (btn.dataset.page === 'admin') renderAdminPanel();
      if (btn.dataset.page === 'withdraw') renderWithdrawList();
    });
  });

  $('#logout-btn').addEventListener('click', () => {
    teardownFirebase();
    localStorage.removeItem('brainrotup_current');
    location.reload();
  });

  $('#rig-enable-btn')?.addEventListener('click', () => adminEnableRig());
  $('#rig-disable-btn')?.addEventListener('click', () => {
    const name = $('#rig-username-input')?.value.trim();
    if (name) adminDisableRig(name);
    else showToast('Введи ник для отключения', 'error');
  });

  $('#upgrade-btn').addEventListener('click', doUpgrade);
  $('#close-modal').addEventListener('click', () => $('#result-modal').classList.remove('open'));

  $('#upgrade-search').addEventListener('input', e => {
    upgradeSearch = e.target.value;
    targetPage = 1;
    renderUpgradeSelectors();
  });

  $('#fast-spin-btn').addEventListener('click', () => {
    fastSpin = !fastSpin;
    $('#fast-spin-btn').classList.toggle('active', fastSpin);
  });

}

document.addEventListener('DOMContentLoaded', () => {
  boot().then(() => {
    initNav();
    initDeposit();
    initWithdraw();
  });
});