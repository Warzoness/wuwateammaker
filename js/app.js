/**
 * Wuthering Waves Matrix Team Maker — Optimized App Controller
 *
 * Performance strategy:
 *  1. Character cards are built ONCE and cached in a Map
 *  2. On state change only the changed parts (energy, badges) are patched in-place
 *  3. A single requestAnimationFrame gate prevents burst renders
 *  4. All inter-card events use event delegation on the container
 *  5. Picker grid is only rendered when the modal is actually open
 */
import { state } from './state.js';
import { sound } from './audio.js';

/* ─── Global Image Fallback Handler ────────────────────────────────────────── */
// Seamlessly fallback between 'data/' and 'public/data/' if one path fails
window.addEventListener('error', (event) => {
  const target = event.target;
  if (target && target.tagName === 'IMG' && !target.dataset.triedFallback) {
    target.dataset.triedFallback = '1';
    const currentSrc = target.getAttribute('src') || '';
    if (currentSrc.startsWith('data/')) {
      target.src = 'public/' + currentSrc;
    } else if (currentSrc.startsWith('public/data/')) {
      target.src = currentSrc.replace('public/', '');
    } else if (currentSrc.includes('/data/')) {
      target.src = currentSrc.replace('/data/', '/public/data/');
    }
  }
}, true);

/* ─── DOM refs ─────────────────────────────────────────────────────────────── */
const teamSlotsContainer = document.getElementById('team-slots-container');
const charactersGrid = document.getElementById('characters-grid');
const poolCounter = document.getElementById('pool-counter');
const teamCountDisplay = document.getElementById('current-stage-display');
const btnClearSquad = document.getElementById('btn-clear-squad');
const btnSaveTeam = document.getElementById('btn-deploy-matrix');
const saveBtnText = document.getElementById('deploy-btn-text');
const squadStatusText = document.getElementById('squad-status-text');
const squadCountText = document.getElementById('squad-count-text');
const statusDots = [0, 1, 2].map(i => document.getElementById(`dot-${i}`));

const globalEnergyInput = document.getElementById('global-energy-input');
const btnApplyGlobalEnergy = document.getElementById('btn-apply-global-energy');
const btnResetAllEnergy = document.getElementById('btn-reset-all-energy');
const searchInput = document.getElementById('search-input');
const searchClearBtn = document.getElementById('search-clear-btn');
const btnToggleSound = document.getElementById('btn-toggle-sound');
const soundIcon = document.getElementById('sound-icon');
const btnViewTeams = document.getElementById('btn-view-history');

const modalSaveSuccess = document.getElementById('modal-deploy-success');
const modalBtnCloseDeployX = document.getElementById('modal-btn-close-deploy-x');
const modalTeamRow = document.getElementById('modal-team-row');
const modalSaveTitle = document.getElementById('modal-stage-title');
const modalBtnNewTeam = document.getElementById('modal-btn-stay');
const modalBtnDone = document.getElementById('modal-btn-next-stage');

const modalTeamList = document.getElementById('modal-history');
const teamListContainer = document.getElementById('history-runs-list');
const modalBtnCloseTeams = document.getElementById('modal-btn-close-history');
const modalBtnCloseTeamsX = document.getElementById('modal-btn-close-history-x');
const modalBtnClearAll = document.getElementById('modal-btn-reset-history');
const btnViewCompact = document.getElementById('btn-view-compact');
const btnViewDetailed = document.getElementById('btn-view-detailed');
const historySearchInput = document.getElementById('history-search-input');
const historySearchClear = document.getElementById('history-search-clear');
const historyTotalBadge = document.getElementById('history-total-badge');
const historyFooterCounter = document.getElementById('history-footer-counter');

const modalCharacterPicker = document.getElementById('modal-character-picker');
const pickerSlotBadge = document.getElementById('picker-slot-badge');
const pickerTitleEl = document.getElementById('picker-title');
const pickerSubtitle = document.getElementById('picker-subtitle');
const pickerCloseBtn = document.getElementById('picker-close-btn');
const pickerSearchInput = document.getElementById('picker-search-input');
const pickerSearchClear = document.getElementById('picker-search-clear');
const pickerCharactersGrid = document.getElementById('picker-characters-grid');

/* ─── State ────────────────────────────────────────────────────────────────── */
/** @type {Map<string, HTMLElement>} charId → card element */
const cardCache = new Map();
let activePickerSlotIndex = null;
let pickerFilter = { search: '', element: 'ALL', status: 'ALL' };
let historyViewMode = localStorage.getItem('wuwa_team_view_mode') || 'compact';
let historySearchQuery = '';
let pendingRender = false;
let pickerPending = false;

const SLOT_ROLES = [
  { title: 'VỊ TRÍ 1' },
  { title: 'VỊ TRÍ 2' },
  { title: 'VỊ TRÍ 3' },
];

/* ─── rAF-gated render scheduler ──────────────────────────────────────────── */
function scheduleRender() {
  if (pendingRender) return;
  pendingRender = true;
  requestAnimationFrame(() => {
    pendingRender = false;
    updateTeamSlots();
    updateArenaStatus();
    updateCharacterPool();
    updateTeamListBadge();
    if (modalCharacterPicker.classList.contains('open')) schedulePickerRender();
  });
}

function schedulePickerRender() {
  if (pickerPending) return;
  pickerPending = true;
  requestAnimationFrame(() => {
    pickerPending = false;
    renderPickerGrid();
  });
}

/* ═══════════════════════════════════════════════════════════════════════════
   TEAM SLOTS
   ═══════════════════════════════════════════════════════════════════════════ */

/** Snapshot: charId per slot to detect what actually changed */
let prevSquad = [null, null, null];

function updateTeamSlots() {
  const { currentSquad } = state;

  currentSquad.forEach((char, idx) => {
    const prevCharId = prevSquad[idx];
    const samePerson = char && prevCharId && char.id === prevCharId;

    if (samePerson) {
      // Only patch the energy remaining label — no DOM rebuild
      const slotEl = teamSlotsContainer.querySelector(`[data-slot-index="${idx}"]`);
      if (slotEl) {
        const energyBadge = slotEl.querySelector('.slot-energy-deduction-badge span:last-child');
        if (energyBadge) energyBadge.textContent = `(Còn: ${char.currentEnergy})`;
      }
      return;
    }

    // Slot occupant changed — rebuild this slot only
    rebuildSlot(idx, char);
    prevSquad[idx] = char ? char.id : null;
  });
}

function rebuildSlot(index, char) {
  const role = SLOT_ROLES[index];

  // Remove existing slot element if any
  const existing = teamSlotsContainer.querySelector(`[data-slot-index="${index}"]`);
  if (existing) existing.remove();

  const slotEl = document.createElement('div');
  slotEl.className = `team-slot ${char ? 'occupied' : 'empty'}`;
  slotEl.dataset.slotIndex = index;

  // Header bar
  slotEl.insertAdjacentHTML('beforeend', `
    <div class="slot-header-bar">
      <span class="slot-role-tag">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="10"/></svg>
        ${role.title}
      </span>
      <span class="slot-index-badge">SLOT ${index + 1}</span>
    </div>
  `);

  if (char) {
    const rarityClass = char.rarity === 5 ? 'rarity-5' : 'rarity-4';
    const elementClass = char.attribute.toLowerCase();

    const inner = document.createElement('div');
    inner.className = 'slot-character-inner animate-pop-in';
    inner.dataset.charId = char.id;
    inner.innerHTML = `
      <button class="slot-remove-btn" data-remove-index="${index}" title="Gỡ khỏi đội hình (Hoàn lại 1 năng lượng)">✕</button>
      <div class="slot-avatar-wrapper ${rarityClass}">
        <img src="${char.image}" alt="${char.name}" class="slot-avatar-img" loading="lazy" draggable="false">
      </div>
      <div class="slot-character-name">${char.name}</div>
      <div class="slot-badges-row">
        <span class="element-pill ${elementClass}">${char.attribute}</span>
        <span class="weapon-pill">${char.weapon}</span>
      </div>
      <div class="slot-energy-deduction-badge" title="Đã trừ 1 năng lượng khi xếp vào slot">
        <span>⚡ -1 NL</span>
        <span style="opacity:.7;font-size:.75rem">(Còn: ${char.currentEnergy})</span>
      </div>
      <button class="slot-change-btn" data-open-picker="${index}">🔄 Đổi Nhân Vật</button>
    `;
    slotEl.appendChild(inner);
  } else {
    const empty = document.createElement('div');
    empty.className = 'slot-empty-content';
    empty.dataset.openPicker = index;
    empty.innerHTML = `
      <div class="slot-empty-icon radar-ring">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
        </svg>
      </div>
      <div class="slot-empty-title">BẤM ĐỂ CHỌN NHÂN VẬT</div>
      <button class="btn btn-primary" style="font-size:.85rem;padding:7px 18px;pointer-events:none">➕ Chọn Resonator</button>
      <div class="slot-empty-hint">${role.hint}</div>
    `;
    slotEl.appendChild(empty);
  }

  teamSlotsContainer.appendChild(slotEl);
}

/* ═══════════════════════════════════════════════════════════════════════════
   ARENA STATUS BAR
   ═══════════════════════════════════════════════════════════════════════════ */
function updateArenaStatus() {
  const filledCount = state.getFilledSlotCount();
  const teamCount = state.savedTeams.length;
  const isEditing = state.editingTeamId !== null;

  teamCountDisplay.textContent = isEditing ? '✏️ ĐANG CHỈNH SỬA TEAM' : `📋 ${teamCount} TEAM ĐÃ LƯU`;
  squadCountText.textContent = `${filledCount} / 3`;

  statusDots.forEach((dot, i) =>
    dot.classList.toggle('filled', state.currentSquad[i] !== null)
  );

  if (filledCount > 0) {
    squadStatusText.innerHTML = `Tiến độ: <strong>${filledCount} / 3</strong> nhân vật — <span style="color:var(--status-success)">Sẵn sàng lưu!</span>`;
    btnSaveTeam.disabled = false;
    btnSaveTeam.classList.add('ready');
    saveBtnText.textContent = isEditing ? '💾 CẬP NHẬT TEAM ➔' : '💾 LƯU TEAM VÀO DANH SÁCH ➔';
  } else {
    squadStatusText.innerHTML = `Tiến độ: <strong>0 / 3</strong> nhân vật — (Chọn ít nhất 1 nhân vật để lưu)`;
    btnSaveTeam.disabled = true;
    btnSaveTeam.classList.remove('ready');
    saveBtnText.textContent = 'Chọn Ít Nhất 1 Nhân Vật Để Lưu Team';
  }
}

/** Update team count badge on the "Xem Team" button */
function updateTeamListBadge() {
  const count = state.savedTeams.length;
  btnViewTeams.querySelector('span').textContent = `📋 Danh Sách Team (${count})`;
}

/* ═══════════════════════════════════════════════════════════════════════════
   CHARACTER POOL — cache-based selective update
   ═══════════════════════════════════════════════════════════════════════════ */

/** Renders each card for the first time and inserts into DOM */
function buildPoolCards() {
  const frag = document.createDocumentFragment();
  state.characters.forEach(char => {
    const card = createCharacterCard(char);
    cardCache.set(char.id, card);
    frag.appendChild(card);
  });
  charactersGrid.appendChild(frag);
}

/** Creates a full card element for a character */
function createCharacterCard(char) {
  const elementClass = char.attribute.toLowerCase();
  const rarityClass = char.rarity === 5 ? 'rarity-5' : 'rarity-4';
  const stars = '★'.repeat(char.rarity);
  const energyPct = char.maxEnergy > 0 ? (char.currentEnergy / char.maxEnergy) * 100 : 0;

  const card = document.createElement('div');
  card.className = 'character-card';
  card.dataset.charId = char.id;

  card.innerHTML = `
    <div class="in-squad-badge" style="display:none"></div>
    <div class="card-top-row">
      <span class="element-pill ${elementClass}" style="font-size:.68rem;padding:2px 7px">${char.attribute}</span>
      <div class="rarity-stars">${stars}</div>
    </div>
    <div class="card-avatar-container ${rarityClass}">
      <img src="${char.image}" alt="${char.name}" class="card-avatar-img" loading="lazy" draggable="false">
    </div>
    <div class="card-name" title="${char.name}">${char.name}</div>
    <div class="energy-control-container">
      <div class="energy-label-row">
        <span>NĂNG LƯỢNG</span>
        <span class="energy-values">${char.currentEnergy} / ${char.maxEnergy}</span>
      </div>
      <div class="energy-bar-track"><div class="energy-bar-fill" style="width:${energyPct}%"></div></div>
      <div class="energy-input-row">
        <button class="energy-step-btn btn-minus" data-char-id="${char.id}" title="Giảm 1">-</button>
        <input type="number" class="energy-num-input" data-char-id="${char.id}" min="0" max="99" value="${char.currentEnergy}">
        <button class="energy-step-btn btn-plus" data-char-id="${char.id}" title="Tăng 1">+</button>
      </div>
    </div>
    <div class="exhausted-overlay" style="display:none">
      <span class="exhausted-tag">⛔ CẠN NĂNG LƯỢNG (0)</span>
    </div>
  `;

  // Rarity star color
  const starsEl = card.querySelector('.rarity-stars');
  starsEl.style.color = char.rarity === 5 ? 'var(--wuwa-gold)' : 'var(--rarity-4)';

  return card;
}

/** Patches only the visible parts of an existing card that may have changed */
function patchCard(card, char) {
  const isExhausted = char.currentEnergy <= 0;
  const inSquadIndex = state.getCharacterSquadSlot(char.id);
  const inSquad = inSquadIndex !== -1;
  const energyPct = char.maxEnergy > 0 ? (char.currentEnergy / char.maxEnergy) * 100 : 0;

  // Class state
  card.classList.toggle('exhausted', isExhausted);
  card.classList.toggle('in-squad', inSquad);
  card.draggable = !isExhausted;

  // In-squad badge
  const inSquadBadge = card.querySelector('.in-squad-badge');
  if (inSquad) {
    inSquadBadge.textContent = `ĐANG XẾP SLOT ${inSquadIndex + 1}`;
    inSquadBadge.style.display = '';
  } else {
    inSquadBadge.style.display = 'none';
  }

  // Energy label
  const energyValues = card.querySelector('.energy-values');
  energyValues.textContent = `${char.currentEnergy} / ${char.maxEnergy}`;
  energyValues.classList.toggle('zero', isExhausted);

  // Energy bar
  const barFill = card.querySelector('.energy-bar-fill');
  barFill.style.width = `${energyPct}%`;
  barFill.classList.toggle('empty', isExhausted);

  // Number input (only if not focused to avoid fighting user)
  const numInput = card.querySelector('.energy-num-input');
  if (document.activeElement !== numInput) numInput.value = char.currentEnergy;

  // Minus btn disabled
  const minusBtn = card.querySelector('.btn-minus');
  minusBtn.disabled = isExhausted;

  // Exhausted overlay
  const overlay = card.querySelector('.exhausted-overlay');
  overlay.style.display = isExhausted ? '' : 'none';
}

/** Called on every render: filter, show/hide, patch in-place */
function updateCharacterPool() {
  const filtered = state.getFilteredCharacters();
  const filteredSet = new Set(filtered.map(c => c.id));
  let visibleCount = 0;

  // Patch or show/hide each cached card
  cardCache.forEach((card, charId) => {
    const char = state.characters.find(c => c.id === charId);
    const visible = filteredSet.has(charId);
    card.style.display = visible ? '' : 'none';
    if (visible && char) {
      patchCard(card, char);
      visibleCount++;
    }
  });

  // Update counter
  poolCounter.innerHTML = `Hiển thị: <strong>${visibleCount}</strong> / ${state.characters.length}`;
}

/* ═══════════════════════════════════════════════════════════════════════════
   CHARACTER PICKER MODAL
   ═══════════════════════════════════════════════════════════════════════════ */
function openCharacterPickerModal(slotIndex) {
  activePickerSlotIndex = slotIndex;
  const role = SLOT_ROLES[slotIndex];

  pickerSlotBadge.textContent = `CHỌN CHO SLOT ${slotIndex + 1}`;
  pickerTitleEl.textContent = `Chọn Resonator — ${role.title}`;
  pickerSubtitle.textContent = `Nhấn vào một nhân vật để xếp vào Slot ${slotIndex + 1} • Tiêu hao 1 năng lượng`;

  // Reset filters
  pickerSearchInput.value = '';
  pickerSearchClear.style.display = 'none';
  pickerFilter = { search: '', element: 'ALL', status: 'ALL' };

  document.querySelectorAll('[data-picker-elem]').forEach(
    p => p.classList.toggle('active', p.dataset.pickerElem === 'ALL')
  );
  document.querySelectorAll('[data-picker-status]').forEach(
    p => p.classList.toggle('active', p.dataset.pickerStatus === 'ALL')
  );

  renderPickerGrid();
  modalCharacterPicker.classList.add('open');
  sound.playSelect();
  requestAnimationFrame(() => pickerSearchInput.focus());
}

function closeCharacterPickerModal() {
  modalCharacterPicker.classList.remove('open');
  activePickerSlotIndex = null;
}

/** Picker grid is rebuilt on open/filter — 60 small cards, acceptable cost */
function renderPickerGrid() {
  const filtered = state.characters.filter(c => {
    if (pickerFilter.search) {
      const q = pickerFilter.search.toLowerCase();
      if (!c.name.toLowerCase().includes(q) &&
        !c.rawName.toLowerCase().includes(q) &&
        !c.attribute.toLowerCase().includes(q) &&
        !c.weapon.toLowerCase().includes(q)) return false;
    }
    if (pickerFilter.element !== 'ALL' && c.attribute !== pickerFilter.element) return false;
    if (pickerFilter.status === 'AVAILABLE' && c.currentEnergy <= 0) return false;
    return true;
  });

  const frag = document.createDocumentFragment();

  if (!filtered.length) {
    const msg = document.createElement('div');
    msg.style.cssText = 'grid-column:1/-1;text-align:center;padding:40px;color:var(--text-dim)';
    msg.textContent = 'Không tìm thấy nhân vật nào phù hợp.';
    frag.appendChild(msg);
  } else {
    filtered.forEach(char => {
      const isExhausted = char.currentEnergy <= 0;
      const inSquadIndex = state.getCharacterSquadSlot(char.id);
      const inSquad = inSquadIndex !== -1;
      const isCurrentSlot = inSquadIndex === activePickerSlotIndex;

      const card = document.createElement('div');
      card.className = `picker-char-card ${char.rarity === 5 ? 'rarity-5' : 'rarity-4'} ${isExhausted ? 'exhausted' : ''} ${inSquad ? 'in-squad' : ''}`;
      card.dataset.charId = char.id;
      card.title = isExhausted ? `${char.name} (Cạn NL)` : `${char.name} — ${char.attribute}`;

      card.innerHTML = `
        <div class="card-top-row" style="width:100%">
          <span class="element-pill ${char.attribute.toLowerCase()}" style="font-size:.65rem;padding:1px 6px">${char.attribute}</span>
          <span style="font-size:.7rem;color:${char.rarity === 5 ? 'var(--wuwa-gold)' : 'var(--rarity-4)'}">${'★'.repeat(char.rarity)}</span>
        </div>
        <div class="picker-card-avatar">
          <img src="${char.image}" alt="${char.name}" loading="lazy" draggable="false">
        </div>
        <div class="picker-card-name">${char.name}</div>
        <div class="picker-card-energy-badge ${isExhausted ? 'zero' : ''}">
          ⚡ ${char.currentEnergy}/${char.maxEnergy} NL
        </div>
        ${isCurrentSlotOccupant(isCurrentSlot)}
        ${inSquad && !isCurrentSlot ? `<div style="font-size:.65rem;color:var(--wuwa-gold);font-weight:700">Ở SLOT ${inSquadIndex + 1}</div>` : ''}
        ${isExhausted ? '<div class="exhausted-overlay" style="border-radius:var(--radius-md)"><span class="exhausted-tag" style="font-size:.65rem;padding:2px 6px">⛔ 0 NL</span></div>' : ''}
      `;
      frag.appendChild(card);
    });
  }

  pickerCharactersGrid.innerHTML = '';
  pickerCharactersGrid.appendChild(frag);
}

function isCurrentSlotOccupant(flag) {
  return flag
    ? '<div style="font-size:.65rem;color:var(--wuwa-cyan);font-weight:700">✓ ĐANG Ở SLOT NÀY</div>'
    : '';
}

/* ═══════════════════════════════════════════════════════════════════════════
   EVENT DELEGATION
   ═══════════════════════════════════════════════════════════════════════════ */
function setupEvents() {
  /* ── Team Slots container (delegation) ──────────────────────────── */
  teamSlotsContainer.addEventListener('click', (e) => {
    // Remove from slot
    const removeBtn = e.target.closest('[data-remove-index]');
    if (removeBtn) {
      state.removeFromSlot(+removeBtn.dataset.removeIndex);
      sound.playRemove();
      return;
    }
    // Open picker (change button or empty slot)
    const pickerTrigger = e.target.closest('[data-open-picker]');
    if (pickerTrigger) {
      openCharacterPickerModal(+pickerTrigger.dataset.openPicker);
      return;
    }
    // Clicking inside occupied inner also opens picker
    const slotInner = e.target.closest('.slot-character-inner');
    if (slotInner) {
      const slotEl = slotInner.closest('.team-slot');
      if (slotEl) openCharacterPickerModal(+slotEl.dataset.slotIndex);
    }
  });

  /* ── Character pool (delegation) ────────────────────────────────── */
  charactersGrid.addEventListener('click', (e) => {
    // Energy step buttons
    const minus = e.target.closest('.btn-minus');
    const plus = e.target.closest('.btn-plus');
    if (minus || plus) {
      const charId = (minus || plus).dataset.charId;
      const char = state.characters.find(c => c.id === charId);
      if (!char) return;
      const delta = minus ? -1 : 1;
      const newE = char.currentEnergy + delta;
      // When pressing +, allow maxEnergy to grow if currentEnergy would exceed it
      const newMax = plus ? Math.max(newE, char.maxEnergy) : char.maxEnergy;
      state.updateCharacterEnergy(charId, newE, newMax);
      sound.playHover();
      return;
    }

    // Card click → auto-assign or remove
    const card = e.target.closest('.character-card');
    if (!card || e.target.closest('.energy-control-container')) return;
    const charId = card.dataset.charId;
    const char = state.characters.find(c => c.id === charId);
    if (!char) return;

    if (char.currentEnergy <= 0) { sound.playError(); return; }

    const inSlot = state.getCharacterSquadSlot(charId);
    if (inSlot !== -1) {
      state.removeFromSlot(inSlot);
      sound.playRemove();
    } else if (state.autoAssign(charId)) {
      sound.playDrop();
    } else {
      sound.playError();
    }
  });

  charactersGrid.addEventListener('change', (e) => {
    const input = e.target.closest('.energy-num-input');
    if (!input) return;
    const charId = input.dataset.charId;
    const char = state.characters.find(c => c.id === charId);
    if (!char) return;
    const val = Math.max(0, parseInt(input.value, 10) || 0);
    state.updateCharacterEnergy(charId, val, Math.max(val, char.maxEnergy));
  });

  /* ── Picker modal (delegation) ──────────────────────────────────── */
  pickerCharactersGrid.addEventListener('click', (e) => {
    const card = e.target.closest('.picker-char-card');
    if (!card) return;
    const charId = card.dataset.charId;
    const char = state.characters.find(c => c.id === charId);
    if (!char || char.currentEnergy <= 0) { sound.playError(); return; }

    if (activePickerSlotIndex !== null) {
      const ok = state.assignToSlot(charId, activePickerSlotIndex);
      if (ok) {
        sound.playDrop();
        closeCharacterPickerModal();
      } else {
        sound.playError();
      }
    }
  });

  pickerCloseBtn.addEventListener('click', () => {
    closeCharacterPickerModal();
    sound.playHover();
  });

  /* ── Picker search / filter ─────────────────────────────────────── */
  const PICKER_DEBOUNCE_MS = 120;
  let pickerSearchTimer;
  pickerSearchInput.addEventListener('input', (e) => {
    pickerFilter.search = e.target.value;
    pickerSearchClear.style.display = e.target.value ? 'block' : 'none';
    clearTimeout(pickerSearchTimer);
    pickerSearchTimer = setTimeout(schedulePickerRender, PICKER_DEBOUNCE_MS);
  });

  pickerSearchClear.addEventListener('click', () => {
    pickerSearchInput.value = '';
    pickerSearchClear.style.display = 'none';
    pickerFilter.search = '';
    schedulePickerRender();
    pickerSearchInput.focus();
  });

  document.querySelectorAll('[data-picker-elem]').forEach(pill => {
    pill.addEventListener('click', () => {
      pill.parentElement.querySelectorAll('[data-picker-elem]').forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      pickerFilter.element = pill.dataset.pickerElem;
      schedulePickerRender();
      sound.playHover();
    });
  });

  document.querySelectorAll('[data-picker-status]').forEach(pill => {
    pill.addEventListener('click', () => {
      pill.parentElement.querySelectorAll('[data-picker-status]').forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      pickerFilter.status = pill.dataset.pickerStatus;
      schedulePickerRender();
      sound.playHover();
    });
  });

  /* ── Global Controls ────────────────────────────────────────────── */
  btnClearSquad.addEventListener('click', () => {
    state.clearSquad();
    sound.playRemove();
  });

  btnApplyGlobalEnergy.addEventListener('click', () => {
    const val = parseInt(globalEnergyInput.value, 10);
    if (!isNaN(val) && val > 0) {
      state.setDefaultMaxEnergy(val);
      sound.playSelect();
    }
  });

  btnResetAllEnergy.addEventListener('click', () => {
    if (confirm('Khôi phục toàn bộ năng lượng về mức tối đa cho tất cả các nhân vật?')) {
      state.resetAllEnergy();
      sound.playSelect();
    }
  });

  /* ── Search (debounced) ──────────────────────────────────────────── */
  let searchTimer;
  searchInput.addEventListener('input', (e) => {
    searchClearBtn.style.display = e.target.value ? 'block' : 'none';
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => state.setFilter('search', e.target.value), 150);
  });

  searchClearBtn.addEventListener('click', () => {
    searchInput.value = '';
    searchClearBtn.style.display = 'none';
    state.setFilter('search', '');
    searchInput.focus();
  });

  /* ── Filter pills ────────────────────────────────────────────────── */
  document.querySelectorAll('.filter-pill[data-filter-type]').forEach(pill => {
    pill.addEventListener('click', () => {
      pill.parentElement.querySelectorAll('.filter-pill').forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      state.setFilter(pill.dataset.filterType, pill.dataset.val);
      sound.playHover();
    });
  });

  /* ── Sound Toggle ───────────────────────────────────────────────── */
  btnToggleSound.addEventListener('click', () => {
    const muted = sound.toggleMute();
    soundIcon.textContent = muted ? '🔇' : '🔊';
    btnToggleSound.classList.toggle('active', !muted);
  });

  /* ── Save Team ──────────────────────────────────────────────────── */
  btnSaveTeam.addEventListener('click', () => {
    if (state.getFilledSlotCount() === 0) { sound.playError(); return; }
    const defaultName = state.editingTeamId
      ? (state.savedTeams.find(t => t.id === state.editingTeamId)?.name || 'Team')
      : `Team ${state.savedTeams.length + 1}`;
    const teamName = prompt('Đặt tên cho team:', defaultName);
    if (teamName === null) return; // cancelled
    const record = state.saveTeam(teamName || defaultName);
    if (record) {
      sound.playStartRun();
      showSaveSuccessModal(record);
    }
  });

  modalBtnNewTeam.addEventListener('click', () => {
    modalSaveSuccess.classList.remove('open');
    sound.playSelect();
  });
  modalBtnDone.addEventListener('click', () => {
    modalSaveSuccess.classList.remove('open');
    renderTeamListModal();
    modalTeamList.classList.add('open');
    sound.playSelect();
  });

  /* ── Team List & History Controls ─────────────────────────────────── */
  const openTeamListModal = () => {
    renderTeamListModal();
    modalTeamList.classList.add('open');
    sound.playSelect();
  };

  btnViewTeams.addEventListener('click', openTeamListModal);
  if (teamCountDisplay) {
    teamCountDisplay.style.cursor = 'pointer';
    teamCountDisplay.title = 'Nhấn để xem danh sách đội hình đã lưu';
    teamCountDisplay.addEventListener('click', openTeamListModal);
  }

  if (btnViewCompact) {
    btnViewCompact.addEventListener('click', () => setHistoryViewMode('compact'));
  }
  if (btnViewDetailed) {
    btnViewDetailed.addEventListener('click', () => setHistoryViewMode('detailed'));
  }

  if (historySearchInput) {
    historySearchInput.addEventListener('input', (e) => {
      historySearchQuery = e.target.value.trim().toLowerCase();
      if (historySearchClear) {
        historySearchClear.style.display = historySearchQuery ? 'block' : 'none';
      }
      renderTeamListModal();
    });
  }

  if (historySearchClear) {
    historySearchClear.addEventListener('click', () => {
      historySearchInput.value = '';
      historySearchQuery = '';
      historySearchClear.style.display = 'none';
      historySearchInput.focus();
      renderTeamListModal();
    });
  }

  modalBtnCloseTeams.addEventListener('click', () => modalTeamList.classList.remove('open'));
  if (modalBtnCloseTeamsX) {
    modalBtnCloseTeamsX.addEventListener('click', () => modalTeamList.classList.remove('open'));
  }
  if (modalBtnCloseDeployX) {
    modalBtnCloseDeployX.addEventListener('click', () => modalSaveSuccess.classList.remove('open'));
  }
  modalBtnClearAll.addEventListener('click', () => {
    if (confirm('Xóa toàn bộ danh sách team đã lưu và bắt đầu lại?')) {
      state.clearAllTeams();
      modalTeamList.classList.remove('open');
      sound.playRemove();
    }
  });

  // Delegation for edit/delete inside team list modal
  teamListContainer.addEventListener('click', (e) => {
    const editBtn = e.target.closest('[data-edit-team]');
    if (editBtn) {
      state.editTeam(editBtn.dataset.editTeam);
      modalTeamList.classList.remove('open');
      // Pre-fill the global energy input with the current defaultMaxEnergy
      if (globalEnergyInput) globalEnergyInput.value = state.defaultMaxEnergy;
      sound.playSelect();
      return;
    }
    const deleteBtn = e.target.closest('[data-delete-team]');
    if (deleteBtn) {
      if (confirm('Bạn có chắc muốn xóa đội hình này?')) {
        state.deleteTeam(deleteBtn.dataset.deleteTeam);
        renderTeamListModal();
        sound.playRemove();
      }
    }
  });

  /* ── Backdrop / Escape ──────────────────────────────────────────── */
  [modalSaveSuccess, modalTeamList, modalCharacterPicker].forEach(modal => {
    modal.addEventListener('click', e => { if (e.target === modal) modal.classList.remove('open'); });
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      [modalSaveSuccess, modalTeamList, modalCharacterPicker].forEach(m => m.classList.remove('open'));
    }
  });
}

/* ═══════════════════════════════════════════════════════════════════════════
   MODALS
   ═══════════════════════════════════════════════════════════════════════════ */
function setHistoryViewMode(mode) {
  historyViewMode = mode;
  localStorage.setItem('wuwa_team_view_mode', mode);
  sound.playSelect();
  renderTeamListModal();
}

function showSaveSuccessModal(record) {
  modalSaveTitle.textContent = `✅ TEAM "${record.name}" ĐÃ LƯU`;
  const frag = document.createDocumentFragment();
  record.members.forEach(m => {
    const el = document.createElement('div');
    el.className = 'modal-team-member';
    el.innerHTML = `
      <img src="${m.image}" alt="${m.name}" class="modal-team-avatar">
      <div style="font-weight:700;font-size:.95rem">${m.name}</div>
      <span class="element-pill ${m.attribute.toLowerCase()}" style="font-size:.7rem;padding:2px 8px">${m.attribute}</span>
      <div style="font-size:.78rem;color:var(--text-dim);margin-top:4px">NL còn: <strong>${m.remainingEnergy}</strong></div>
    `;
    frag.appendChild(el);
  });
  modalTeamRow.innerHTML = '';
  modalTeamRow.appendChild(frag);
  modalSaveSuccess.classList.add('open');
}

function renderTeamListModal() {
  teamListContainer.innerHTML = '';
  const totalTeams = state.savedTeams.length;

  if (historyTotalBadge) {
    historyTotalBadge.textContent = `${totalTeams} TEAM`;
  }

  // Update toggle button states and container classes
  if (btnViewCompact && btnViewDetailed) {
    btnViewCompact.classList.toggle('active', historyViewMode === 'compact');
    btnViewDetailed.classList.toggle('active', historyViewMode === 'detailed');
  }
  teamListContainer.classList.toggle('compact-mode', historyViewMode === 'compact');
  teamListContainer.classList.toggle('detailed-mode', historyViewMode === 'detailed');

  if (!totalTeams) {
    teamListContainer.innerHTML = `
      <div class="history-empty-state">
        <span style="font-size:2.4rem;line-height:1">📋</span>
        <div style="font-size:1.05rem;font-weight:600;color:var(--text-main)">Chưa có team nào được lưu</div>
        <div style="font-size:0.88rem;color:var(--text-dim)">Hãy chọn 3 Resonator và nhấn "Lưu Team Vào Danh Sách"!</div>
      </div>
    `;
    if (historyFooterCounter) historyFooterCounter.innerHTML = 'Hiển thị: <strong>0</strong> team';
    return;
  }

  // Filter teams if search query is active
  let displayTeams = state.savedTeams;
  if (historySearchQuery) {
    displayTeams = state.savedTeams.filter(team => {
      const matchName = team.name.toLowerCase().includes(historySearchQuery);
      const matchMember = team.members.some(m =>
        m.name.toLowerCase().includes(historySearchQuery) ||
        m.attribute.toLowerCase().includes(historySearchQuery)
      );
      return matchName || matchMember;
    });
  }

  if (historyFooterCounter) {
    historyFooterCounter.innerHTML = `Hiển thị: <strong>${displayTeams.length}</strong> / ${totalTeams} team`;
  }

  if (!displayTeams.length) {
    teamListContainer.innerHTML = `
      <div class="history-empty-state">
        <span style="font-size:2.2rem;line-height:1">🔍</span>
        <div style="font-size:1rem;font-weight:600;color:var(--text-main)">Không tìm thấy đội hình nào</div>
        <div style="font-size:0.85rem;color:var(--text-dim)">Không có team nào khớp với từ khóa "<strong>${historySearchQuery}</strong>"</div>
      </div>
    `;
    return;
  }

  const frag = document.createDocumentFragment();

  displayTeams.forEach((team) => {
    // Find absolute 1-based index in state.savedTeams
    const realIndex = state.savedTeams.findIndex(t => t.id === team.id) + 1;
    const item = document.createElement('div');

    if (historyViewMode === 'compact') {
      item.className = 'history-team-card compact';
      item.innerHTML = `
        <div class="compact-card-header">
          <div class="compact-title-group">
            <span class="compact-team-badge">#${realIndex}</span>
            <span class="compact-team-name" title="${team.name}">${team.name}</span>
          </div>
          <div class="compact-card-actions">
            <button class="compact-action-btn edit" data-edit-team="${team.id}" title="Sửa đội hình (nạp lại vào ô)">
              ✏️ Sửa
            </button>
            <button class="compact-action-btn delete" data-delete-team="${team.id}" title="Xóa đội hình này">
              🗑️
            </button>
          </div>
        </div>

        <div class="compact-members-grid">
          ${team.members.map(m => `
            <div class="compact-member-item attr-${m.attribute.toLowerCase()}" title="${m.name} (${m.attribute}) — NL còn: ${m.remainingEnergy}">
              <div class="compact-avatar-wrapper attr-${m.attribute.toLowerCase()}">
                <img src="${m.image}" alt="${m.name}" class="compact-avatar-img" loading="lazy">
                <span class="compact-attr-badge attr-${m.attribute.toLowerCase()}">${m.attribute.slice(0, 3)}</span>
              </div>
              <span class="compact-member-name">${m.name}</span>
            </div>
          `).join('')}
        </div>

        <div class="compact-card-footer">
          <span class="compact-date-text">🕒 ${team.date} ${team.timestamp}</span>
        </div>
      `;
    } else {
      // Detailed Mode
      item.className = 'history-team-card detailed';
      item.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px">
          <div>
            <div style="display:flex;align-items:center;gap:8px">
              <span class="compact-team-badge">#${realIndex}</span>
              <div style="font-family:var(--font-display);font-weight:700;color:var(--wuwa-gold);font-size:1.15rem">🏷️ ${team.name}</div>
            </div>
            <div style="font-size:.78rem;color:var(--text-dim);margin-top:2px">📅 ${team.date} lúc ${team.timestamp}</div>
          </div>
          <div style="display:flex;gap:8px">
            <button class="btn btn-secondary" data-edit-team="${team.id}" style="font-size:.82rem;padding:6px 14px">✏️ Sửa</button>
            <button class="btn btn-danger-ghost" data-delete-team="${team.id}" style="font-size:.82rem;padding:6px 14px">🗑️ Xóa</button>
          </div>
        </div>
        <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center">
          ${team.members.map(m => `
            <div style="display:flex;align-items:center;gap:10px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.08);padding:8px 12px;border-radius:10px;flex:1 1 140px;min-width:130px">
              <img src="${m.image}" alt="${m.name}" style="width:44px;height:44px;border-radius:8px;object-fit:contain;background:rgba(0,0,0,.3);flex-shrink:0">
              <div style="display:flex;flex-direction:column;gap:3px;overflow:hidden">
                <span style="font-size:.88rem;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${m.name}</span>
                <div style="display:flex;align-items:center;gap:6px">
                  <span class="element-pill ${m.attribute.toLowerCase()}" style="font-size:.65rem;padding:1px 6px">${m.attribute}</span>
                  <span style="font-size:.75rem;color:var(--text-dim)">NL: <strong style="color:var(--wuwa-gold)">${m.remainingEnergy}</strong></span>
                </div>
              </div>
            </div>`).join('')}
        </div>
      `;
    }

    frag.appendChild(item);
  });

  teamListContainer.appendChild(frag);
}

/* ═══════════════════════════════════════════════════════════════════════════
   INIT
   ═══════════════════════════════════════════════════════════════════════════ */
function checkImageBase() {
  const probe = new Image();
  probe.onerror = () => {
    // If 'data/Aalto.png' fails to load directly, update in-memory paths to 'public/data/'
    state.characters.forEach((c) => {
      if (c.image && c.image.startsWith('data/')) {
        c.image = 'public/' + c.image;
      }
    });
    // Update cached cards
    cardCache.forEach((card, charId) => {
      const img = card.querySelector('.card-avatar-img');
      const char = state.getCharacterById(charId);
      if (img && char) {
        img.src = char.image;
      }
    });
    // Update saved teams
    state.savedTeams.forEach((team) => {
      team.members.forEach((m) => {
        if (m.image && m.image.startsWith('data/')) {
          m.image = 'public/' + m.image;
        }
      });
    });
    scheduleRender();
  };
  probe.src = 'data/Aalto.png';
}

function init() {
  soundIcon.textContent = sound.isMuted() ? '🔇' : '🔊';
  btnToggleSound.classList.toggle('active', !sound.isMuted());

  setupEvents();

  // Proactively verify image accessibility
  checkImageBase();

  // Build pool cards once upfront
  buildPoolCards();

  // Subscribe scheduler
  state.subscribe(() => scheduleRender());

  // Full initial render
  updateTeamSlots();
  updateArenaStatus();
  updateCharacterPool();
  updateTeamListBadge();
}

document.addEventListener('DOMContentLoaded', init);
