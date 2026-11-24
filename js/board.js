function updateSelectionBox() {
  const ids = [...state.selectedIds];
  if (ids.length < 2) {
    selectionBox.hidden = true;
    return;
  }

  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const id of ids) {
    const el = state.els.get(id);
    if (!el) continue;
    const rect = el.getBoundingClientRect();
    left = Math.min(left, rect.left);
    top = Math.min(top, rect.top);
    right = Math.max(right, rect.right);
    bottom = Math.max(bottom, rect.bottom);
  }
  if (!Number.isFinite(left)) {
    selectionBox.hidden = true;
    return;
  }

  const origin = board.getBoundingClientRect();
  const pad = 8;
  selectionBox.style.left = `${left - origin.left - pad}px`;
  selectionBox.style.top = `${top - origin.top - pad}px`;
  selectionBox.style.width = `${right - left + pad * 2}px`;
  selectionBox.style.height = `${bottom - top + pad * 2}px`;
  selectionBox.hidden = false;
}

function updateDockOffset() {
  const toolbar = document.getElementById('toolbar');
  const height = toolbar.getBoundingClientRect().height;
  document.documentElement.style.setProperty('--dock-offset', `${Math.ceil(height) + 26}px`);
}

window.addEventListener('resize', updateDockOffset);

function updatePagination() {
  slotLabel.textContent = state.currentSlot;
  slotPrev.disabled = state.currentSlot <= 1;
  slotNext.disabled = state.currentSlot >= state.slotCount && state.items.size === 0;
  clearBoardButton.disabled = state.items.size === 0;
}

async function goToSlot(slot) {
  if (slot === state.currentSlot || switchingSlot) return;
  switchingSlot = true;
  try {
    await flushSaves();
    await loadSlot(slot);
  } finally {
    switchingSlot = false;
  }
}

async function loadSlot(slot, preloaded = null) {
  suppressHistory = true;
  const data = preloaded || await api(`/api/board?slot=${slot}`);

  for (const el of state.els.values()) el.remove();
  state.els.clear();
  state.items.clear();
  state.links = [];
  state.selectedId = null;
  state.selectedIds.clear();
  state.editingId = null;
  state.pendingLinkFrom = null;
  drag = null;
  hideConfirm();
  clearTimeout(hintTimer);
  hint.hidden = true;
  rubberBand.classList.remove('active');

  state.currentSlot = slot;
  if (data.settings) {
    if (data.settings.camera) state.camera = { ...state.camera, ...data.settings.camera };
    if (typeof data.settings.retro === 'boolean') state.globalRetro = data.settings.retro;
    state.slotCount = Math.max(1, Number(data.settings.slotCount) || 1);
  }
  document.body.classList.toggle('retro-disabled', !state.globalRetro);
  const retroButton = document.getElementById('retroToggle');
  retroButton.title = `Retro: ${state.globalRetro ? 'On' : 'Off'}`;
  retroButton.classList.toggle('on', state.globalRetro);
  retroButton.classList.toggle('off', !state.globalRetro);

  for (const item of data.items) state.items.set(item.id, item);
  state.links = data.links || [];

  applyCamera();
  renderAll();
  for (const item of state.items.values()) fitNote(item);
  saveSettings();
  resetHistory(); // history is session-only and resets on load / board switch
  suppressHistory = false;
}

// Notes grow downward as text is typed and reflow when their width changes.
function fitNote(item) {
  if (!item || item.type !== 'note') return;
  const el = state.els.get(item.id);
  if (!el) return;
  const textarea = el.querySelector('textarea');

  textarea.style.height = 'auto';
  const contentHeight = textarea.scrollHeight;
  textarea.style.height = `${contentHeight}px`;

  // 18px top + 14px bottom padding, plus a little breathing room.
  const needed = Math.max(150, contentHeight + 34);
  if (Math.abs(needed - item.height) > 1) {
    item.height = needed;
    el.style.height = `${needed}px`;
    scheduleSaveItem(item);
  }
  updateSelectionBox();
}

// Caption length is capped by how much width the photo's white strip provides,
// not by a fixed character count. Landscape photos therefore fit more text.
function fitCaptionText(input, text) {
  if (!text) return '';
  const computed = getComputedStyle(input);
  captionMeasure.style.fontFamily = computed.fontFamily;
  captionMeasure.style.fontSize = computed.fontSize;
  captionMeasure.style.fontStyle = computed.fontStyle;
  captionMeasure.style.fontWeight = computed.fontWeight;
  captionMeasure.style.letterSpacing = computed.letterSpacing;

  const maxWidth = input.clientWidth;
  if (!maxWidth) return text;

  captionMeasure.textContent = text;
  if (captionMeasure.offsetWidth <= maxWidth) return text;

  let low = 0;
  let high = text.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    captionMeasure.textContent = text.slice(0, mid);
    if (captionMeasure.offsetWidth <= maxWidth) low = mid;
    else high = mid - 1;
  }
  return text.slice(0, low);
}

function isSelected(id) {
  return id === state.selectedId || state.selectedIds.has(id);
}

function clearSelection() {
  state.selectedId = null;
  state.selectedIds.clear();
  renderAll();
}

function selectMany(ids) {
  state.selectedId = null;
  state.selectedIds = new Set(ids);
  renderAll();
}
