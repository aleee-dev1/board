const board = document.getElementById('board');
const world = document.getElementById('world');
const stringsSvg = document.getElementById('strings');
const fileInput = document.getElementById('fileInput');
const hint = document.getElementById('hint');
const confirmBar = document.getElementById('confirm-bar');
const confirmMessage = document.getElementById('confirm-message');
const rubberBand = document.getElementById('rubber-band');
const selectionBox = document.getElementById('selection-box');
const slotLabel = document.getElementById('slotLabel');
const undoButton = document.getElementById('undoButton');
const redoButton = document.getElementById('redoButton');
const slotPrev = document.getElementById('slotPrev');
const slotNext = document.getElementById('slotNext');
const clearBoardButton = document.getElementById('clearBoard');
const captionMeasure = document.createElement('span');
captionMeasure.style.cssText = 'position:absolute;visibility:hidden;white-space:nowrap;pointer-events:none;';
document.body.appendChild(captionMeasure);
let pendingAction = null;

const state = {
  items: new Map(),
  els: new Map(),
  links: [],
  camera: { x: 0, y: 0, scale: 1 },
  tool: 'select',
  selectedId: null,
  selectedIds: new Set(),
  editingId: null,
  pendingLinkFrom: null,
  globalRetro: true,
  currentSlot: 1,
  slotCount: 1,
};

const HINTS = {
  select: 'Left-drag to move &middot; Wheel to zoom &middot; Right-drag to pan',
  note: 'Click anywhere to drop a note and start typing &middot; Double-click a note to edit it',
  image: 'Choose images or .txt files, or drop them onto the board',
  string: 'Click two items to connect or remove a red string &middot; Esc to cancel',
  tape: 'Click a note or photo to tape it down &middot; click it again to remove the tape',
};

let drag = null;
const saveTimers = new Map();
let settingsTimer = null;
let hintTimer = null;
let switchingSlot = false;
const crackCache = new Map();
const imageCache = new Map();

const HISTORY_LIMIT = 30;
const history = { past: [], future: [] };
let lastCommitted = null;
let suppressHistory = false;

// Deterministic per-item cracks so the wear pattern never jumps between reloads.
function seededRandom(seedText) {
  let value = 0;
  for (let i = 0; i < seedText.length; i++) value = (value * 31 + seedText.charCodeAt(i)) | 0;
  return () => {
    value = (value * 1664525 + 1013904223) | 0;
    return (value >>> 0) / 4294967296;
  };
}

function cracksFor(item) {
  const color = item.type === 'note' ? '#2255a6' : '#ffffff';
  const key = `${item.id}:${color}`;
  if (crackCache.has(key)) return crackCache.get(key);

  const random = seededRandom(key);
  const size = 300;
  const parts = [];

  for (let i = 0; i < 11; i++) {
    const fromLeft = random() > 0.5;
    let x = fromLeft ? random() * size * 0.25 : size - random() * size * 0.25;
    let y = random() * size;
    const steps = 4 + Math.floor(random() * 5);
    const stepX = ((fromLeft ? 1 : -1) * size * (0.7 + random() * 0.5)) / steps;
    let path = `M${x.toFixed(1)} ${y.toFixed(1)}`;
    const points = [[x, y]];

    for (let s = 0; s < steps; s++) {
      x += stepX * (0.6 + random() * 0.8);
      y += (random() - 0.5) * size * 0.3;
      path += ` L${x.toFixed(1)} ${y.toFixed(1)}`;
      points.push([x, y]);
    }
    parts.push(`<path d="${path}" fill="none" stroke="${color}" stroke-width="${(0.5 + random() * 0.9).toFixed(2)}" stroke-opacity="${(0.3 + random() * 0.4).toFixed(2)}" stroke-linecap="round"/>`);

    if (random() > 0.4) {
      const point = points[1 + Math.floor(random() * (points.length - 1))];
      let bx = point[0];
      let by = point[1];
      let branch = `M${bx.toFixed(1)} ${by.toFixed(1)}`;
      const branchSteps = 2 + Math.floor(random() * 3);
      for (let b = 0; b < branchSteps; b++) {
        bx += (random() - 0.5) * size * 0.25;
        by += (random() - 0.35) * size * 0.22;
        branch += ` L${bx.toFixed(1)} ${by.toFixed(1)}`;
      }
      parts.push(`<path d="${branch}" fill="none" stroke="${color}" stroke-width="${(0.4 + random() * 0.5).toFixed(2)}" stroke-opacity="${(0.25 + random() * 0.3).toFixed(2)}" stroke-linecap="round"/>`);
    }

    if (random() > 0.55) {
      const point = points[1 + Math.floor(random() * (points.length - 1))];
      parts.push(`<circle cx="${point[0].toFixed(1)}" cy="${point[1].toFixed(1)}" r="${(2 + random() * 5).toFixed(1)}" fill="${color}" fill-opacity="${(0.08 + random() * 0.12).toFixed(2)}"/>`);
    }
  }

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${parts.join('')}</svg>`;
  const uri = `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
  crackCache.set(key, uri);
  return uri;
}

// ---------- api ----------

async function api(url, options = {}) {
  const response = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || `Request failed (${response.status})`);
  }
  return response.json();
}

// ---------- camera ----------

function boardRect() {
  return board.getBoundingClientRect();
}

function applyCamera() {
  const { x, y, scale } = state.camera;
  world.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
  updateSelectionBox();
}

function screenToWorld(clientX, clientY) {
  const rect = boardRect();
  return {
    x: (clientX - rect.left - state.camera.x) / state.camera.scale,
    y: (clientY - rect.top - state.camera.y) / state.camera.scale,
  };
}

function worldToScreen(wx, wy) {
  const rect = boardRect();
  return {
    x: rect.left + state.camera.x + wx * state.camera.scale,
    y: rect.top + state.camera.y + wy * state.camera.scale,
  };
}

function zoomAt(factor, clientX, clientY) {
  const rect = boardRect();
  const sx = clientX - rect.left;
  const sy = clientY - rect.top;
  const wx = (sx - state.camera.x) / state.camera.scale;
  const wy = (sy - state.camera.y) / state.camera.scale;

  const next = Math.min(3, Math.max(0.25, state.camera.scale * factor));
  state.camera.scale = next;
  state.camera.x = sx - wx * next;
  state.camera.y = sy - wy * next;

  applyCamera();
  scheduleSaveSettings();
}

function zoomFromCenter(factor) {
  const rect = boardRect();
  zoomAt(factor, rect.left + rect.width / 2, rect.top + rect.height / 2);
}

// stagger several dropped files so they don't land exactly on top of each other
function staggerPoint(point, offset) {
  return {
    x: point.x + (offset % 3) * 30,
    y: point.y + Math.floor(offset / 3) * 30,
  };
}

// ---------- persistence ----------

function nextZ() {
  let max = 0;
  for (const item of state.items.values()) max = Math.max(max, item.z);
  return max + 1;
}

function saveItem(item) {
  if (!item) return;
  api(`/api/items/${item.id}?slot=${state.currentSlot}`, {
    method: 'PATCH',
    body: JSON.stringify({
      x: item.x,
      y: item.y,
      width: item.width,
      height: item.height,
      rotation: item.rotation,
      z: item.z,
      text: item.text,
      color: item.color,
      retro: item.retro,
      taped: item.taped,
      caption: item.caption,
    }),
  }).catch((err) => console.warn('Could not save item', err));
  maybeCommitHistory();
}

function scheduleSaveItem(item) {
  clearTimeout(saveTimers.get(item.id));
  saveTimers.set(item.id, setTimeout(() => saveItem(item), 350));
}

function saveSettings() {
  api(`/api/settings?slot=${state.currentSlot}`, {
    method: 'PATCH',
    body: JSON.stringify({
      camera: state.camera,
      retro: state.globalRetro,
      slotCount: state.slotCount,
      lastSlot: state.currentSlot,
    }),
  }).catch((err) => console.warn('Could not save settings', err));
}

function scheduleSaveSettings() {
  clearTimeout(settingsTimer);
  settingsTimer = setTimeout(saveSettings, 400);
}

async function flushSaves() {
  for (const [id, timer] of saveTimers) {
    clearTimeout(timer);
    await saveItem(state.items.get(id));
  }
  saveTimers.clear();
  clearTimeout(settingsTimer);
  await saveSettings();
}

// ---------- session undo / redo ----------

function snapshot() {
  return {
    items: [...state.items.values()].map((item) => ({ ...item })),
    links: state.links.map((link) => ({ ...link })),
  };
}

function updateHistoryButtons() {
  undoButton.disabled = history.past.length === 0;
  redoButton.disabled = history.future.length === 0;
}

function maybeCommitHistory() {
  if (suppressHistory) return;
  const current = snapshot();
  if (lastCommitted && JSON.stringify(current) === JSON.stringify(lastCommitted)) return;
  if (lastCommitted) {
    history.past.push(lastCommitted);
    if (history.past.length > HISTORY_LIMIT) history.past.shift();
    history.future = [];
  }
  lastCommitted = current;
  updateHistoryButtons();
}

function resetHistory() {
  history.past = [];
  history.future = [];
  lastCommitted = snapshot();
  updateHistoryButtons();
}

async function cacheImage(item) {
  if (!item || item.type !== 'image' || imageCache.has(item.id)) return;
  try {
    const response = await fetch(`/api/items/${item.id}/image`);
    if (!response.ok) return;
    const blob = await response.blob();
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
    imageCache.set(item.id, dataUrl);
  } catch (err) {
    console.warn('Could not cache image for undo', err);
  }
}

async function syncToSnapshot(target) {
  const current = snapshot();
  const currentIds = new Set(current.items.map((item) => item.id));
  const targetIds = new Set(target.items.map((item) => item.id));

  for (const item of current.items) {
    if (!targetIds.has(item.id)) {
      await api(`/api/items/${item.id}?slot=${state.currentSlot}`, { method: 'DELETE' });
    }
  }

  for (const item of target.items) {
    if (currentIds.has(item.id)) continue;
    const payload = { ...item, slot: state.currentSlot };
    if (item.type === 'image') {
      const dataUrl = imageCache.get(item.id);
      if (!dataUrl) {
        console.warn('Missing cached image for', item.id);
        continue;
      }
      payload.imageBase64 = dataUrl.split(',')[1] || dataUrl;
    }
    await api(`/api/items?slot=${state.currentSlot}`, { method: 'POST', body: JSON.stringify(payload) });
  }

  for (const item of target.items) {
    const previous = current.items.find((entry) => entry.id === item.id);
    if (!previous || JSON.stringify(previous) === JSON.stringify(item)) continue;
    await api(`/api/items/${item.id}?slot=${state.currentSlot}`, {
      method: 'PATCH',
      body: JSON.stringify({
        x: item.x, y: item.y, width: item.width, height: item.height,
        rotation: item.rotation, z: item.z, text: item.text, color: item.color,
        retro: item.retro, taped: item.taped, caption: item.caption,
      }),
    });
  }

  const currentLinkIds = new Set(current.links.map((link) => link.id));
  const targetLinkIds = new Set(target.links.map((link) => link.id));

  for (const link of current.links) {
    if (!targetLinkIds.has(link.id)) {
      await api(`/api/links/${link.id}?slot=${state.currentSlot}`, { method: 'DELETE' });
    }
  }
  for (const link of target.links) {
    if (currentLinkIds.has(link.id)) continue;
    await api(`/api/links?slot=${state.currentSlot}`, {
      method: 'POST',
      body: JSON.stringify({ id: link.id, a: link.a, b: link.b }),
    });
  }
}

async function applySnapshot(target) {
  await syncToSnapshot(target);

  for (const el of state.els.values()) el.remove();
  state.els.clear();
  state.items.clear();
  for (const item of target.items) state.items.set(item.id, { ...item });
  state.links = target.links.map((link) => ({ ...link }));
  state.selectedId = null;
  state.selectedIds.clear();
  state.editingId = null;
  state.pendingLinkFrom = null;

  renderAll();
  for (const item of state.items.values()) fitNote(item);
}

async function undo() {
  if (suppressHistory || !history.past.length) return;
  suppressHistory = true;
  try {
    const target = history.past.pop();
    history.future.push(snapshot());
    await applySnapshot(target);
    lastCommitted = snapshot();
    updateHistoryButtons();
  } catch (err) {
    console.warn('Undo failed', err);
  } finally {
    suppressHistory = false;
  }
}

async function redo() {
  if (suppressHistory || !history.future.length) return;
  suppressHistory = true;
  try {
    const target = history.future.pop();
    history.past.push(snapshot());
    await applySnapshot(target);
    lastCommitted = snapshot();
    updateHistoryButtons();
  } catch (err) {
    console.warn('Redo failed', err);
  } finally {
    suppressHistory = false;
  }
}

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

// ---------- rendering ----------

function createItemElement(item) {
  const el = document.createElement('div');
  el.className = `item ${item.type === 'note' ? 'note-item' : 'image-item'}`;
  el.dataset.id = item.id;

  const pin = document.createElement('div');
  pin.className = 'pin';
  el.appendChild(pin);

  if (item.type === 'note') {
    const textarea = document.createElement('textarea');
    textarea.className = 'note-text';
    textarea.placeholder = 'Type a note...';
    textarea.spellcheck = true;
    textarea.readOnly = true;

    textarea.addEventListener('pointerdown', (e) => {
      if (textarea.readOnly) return; // let the item handle dragging
      e.stopPropagation();
    });
    textarea.addEventListener('input', () => {
      const current = state.items.get(item.id);
      if (!current) return;
      current.text = textarea.value;
      fitNote(current);
      scheduleSaveItem(current);
    });
    textarea.addEventListener('blur', () => {
      if (state.editingId === item.id) state.editingId = null;
      textarea.readOnly = true;
      saveItem(state.items.get(item.id));
    });

    el.appendChild(textarea);
  } else {
    const img = document.createElement('img');
    img.src = `/api/items/${item.id}/image`;
    img.alt = 'evidence';
    img.draggable = false;
    el.appendChild(img);

    const caption = document.createElement('input');
    caption.type = 'text';
    caption.className = 'image-caption';
    caption.spellcheck = true;
    caption.readOnly = true;
    caption.addEventListener('pointerdown', (e) => {
      if (caption.readOnly) return; // let the item handle dragging
      e.stopPropagation();
    });
    caption.addEventListener('input', () => {
      const current = state.items.get(item.id);
      if (!current) return;
      const fitted = fitCaptionText(caption, caption.value);
      if (fitted !== caption.value) caption.value = fitted;
      current.caption = fitted;
      scheduleSaveItem(current);
    });
    caption.addEventListener('blur', () => {
      if (state.editingId === item.id) state.editingId = null;
      caption.readOnly = true;
      saveItem(state.items.get(item.id));
    });
    el.appendChild(caption);
  }

  if (item.type === 'note') {
    const resize = document.createElement('div');
    resize.className = 'resize-handle';
    resize.title = 'Drag to change width';
    resize.addEventListener('pointerdown', onResizePointerDown);
    el.appendChild(resize);
  }

  const handle = document.createElement('div');
  handle.className = 'rotate-handle';
  handle.title = 'Drag to rotate (hold Shift to snap)';
  el.appendChild(handle);

  const tape = document.createElement('div');
  tape.className = 'tape';
  el.appendChild(tape);

  const cracks = document.createElement('div');
  cracks.className = 'cracks';
  el.appendChild(cracks);

  const actions = document.createElement('div');
  actions.className = 'item-actions';
  actions.innerHTML = `
    <button class="download-action" title="Download" aria-label="Download">
      <svg viewBox="0 0 24 24"><path d="M12 3v12"/><path d="M7 10l5 5 5-5"/><path d="M4 20h16"/></svg>
    </button>
    <button class="delete-action" title="Erase item" aria-label="Erase item">
      <svg viewBox="0 0 24 24"><path d="M8 20L4 16l9-9 7 7-8 6z"/><path d="M13 7l4 4"/><path d="M4 20h16"/></svg>
    </button>
  `;
  actions.addEventListener('pointerdown', (e) => e.stopPropagation());
  actions.addEventListener('dblclick', (e) => e.stopPropagation());
  actions.querySelector('.download-action').addEventListener('click', downloadSelected);
  actions.querySelector('.delete-action').addEventListener('click', deleteSelected);
  el.appendChild(actions);

  el.addEventListener('dblclick', (e) => {
    e.stopPropagation();
    if (state.selectedIds.size > 0) return;
    if (item.type === 'note') startEditing(item.id);
    else startCaptionEditing(item.id);
  });

  el.addEventListener('pointerdown', onItemPointerDown);
  handle.addEventListener('pointerdown', onHandlePointerDown);
  return el;
}

function renderItem(item) {
  let el = state.els.get(item.id);
  if (!el) {
    el = createItemElement(item);
    state.els.set(item.id, el);
    world.appendChild(el);
  }

  el.style.left = `${item.x}px`;
  el.style.top = `${item.y}px`;
  el.style.width = `${item.width}px`;
  el.style.height = `${item.height}px`;
  el.style.zIndex = item.z;
  el.style.transform = `translate(-50%, -50%) rotate(${item.rotation}deg)`;
  el.classList.toggle('selected', isSelected(item.id));
  el.classList.toggle('multi-selected', state.selectedIds.size > 0 && state.selectedIds.has(item.id));
  el.classList.toggle('link-source', state.pendingLinkFrom === item.id);
  el.classList.toggle('retro-off', !item.retro);
  el.classList.toggle('taped', !!item.taped);
  el.querySelector('.cracks').style.backgroundImage = cracksFor(item);

  if (item.type === 'note') {
    el.style.background = item.color || '#f6e6a8';
    const textarea = el.querySelector('textarea');
    if (state.editingId !== item.id) textarea.value = item.text || '';
    textarea.readOnly = state.editingId !== item.id;
  } else {
    const img = el.querySelector('img');
    img.style.width = `${item.width - 20}px`;
    img.style.height = `${item.height - 48}px`;

    const caption = el.querySelector('.image-caption');
    if (state.editingId !== item.id) {
      const current = item.caption || '';
      const fitted = fitCaptionText(caption, current);
      if (fitted !== current) {
        item.caption = fitted;
        scheduleSaveItem(item);
      }
      caption.value = fitted;
    }
    caption.readOnly = state.editingId !== item.id;
  }

  updateSelectionBox();
}

function renderStrings() {
  stringsSvg.innerHTML = '';
  for (const link of state.links) {
    const a = state.items.get(link.a);
    const b = state.items.get(link.b);
    if (!a || !b) continue;
    const distance = Math.hypot(b.x - a.x, b.y - a.y);
    const midX = (a.x + b.x) / 2;
    const midY = (a.y + b.y) / 2 + 30 + distance * 0.12;
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', `M ${a.x} ${a.y} Q ${midX} ${midY} ${b.x} ${b.y}`);
    path.setAttribute('class', 'string');
    stringsSvg.appendChild(path);
  }
}

function renderAll() {
  for (const item of state.items.values()) renderItem(item);
  renderStrings();
  updateSelectionBox();
  updatePagination();
}

function select(id) {
  if (id !== state.selectedId || state.selectedIds.size) hideConfirm();
  state.selectedIds.clear();
  if (state.editingId && state.editingId !== id) {
    const old = state.els.get(state.editingId);
    const field = old && old.querySelector('textarea, .image-caption');
    if (field) field.blur();
  }
  state.selectedId = id;

  if (id) {
    const item = state.items.get(id);
    const max = Math.max(0, ...[...state.items.values()].map((i) => i.z));
    if (item && item.z < max) {
      item.z = max + 1;
      scheduleSaveItem(item);
    }
  }
  renderAll();
}

function startEditing(id) {
  state.editingId = id;
  state.selectedId = id;
  renderAll();
  const el = state.els.get(id);
  if (el) {
    const textarea = el.querySelector('textarea');
    textarea.readOnly = false;
    textarea.focus();
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);
  }
}

function startCaptionEditing(id) {
  state.editingId = id;
  state.selectedId = id;
  renderAll();
  const el = state.els.get(id);
  if (el) {
    const caption = el.querySelector('.image-caption');
    caption.readOnly = false;
    caption.focus();
    caption.setSelectionRange(caption.value.length, caption.value.length);
  }
}

// ---------- creating items ----------

async function createNote(worldPoint, text = '', edit = true) {
  const item = {
    type: 'note',
    x: worldPoint.x,
    y: worldPoint.y,
    width: 190,
    height: 150,
    rotation: Math.floor(Math.random() * 5) - 2,
    z: nextZ(),
    text,
    color: '#f6e6a8',
    retro: true,
    taped: false,
  };
  try {
    const created = await api(`/api/items?slot=${state.currentSlot}`, { method: 'POST', body: JSON.stringify(item) });
    addLocalItem(created);
    if (edit) startEditing(created.id);
    else select(created.id);
  } catch (err) {
    console.warn(err);
    alert('Could not create note: ' + err.message);
  }
}

function addLocalItem(item) {
  state.items.set(item.id, item);
  renderItem(item);
  fitNote(item);
  renderStrings();
  updatePagination();
  maybeCommitHistory();
}

function readAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function prepareImage(file) {
  const dataUrl = await readAsDataURL(file);
  const img = new Image();
  await new Promise((resolve, reject) => {
    img.onload = resolve;
    img.onerror = reject;
    img.src = dataUrl;
  });

  // Store the original bytes untouched — this is a local board, no need to re-encode.
  return {
    dataUrl,
    mime: file.type || 'image/png',
    naturalWidth: img.naturalWidth,
    naturalHeight: img.naturalHeight,
  };
}

async function addImageFile(file, offset = 0) {
  if (!file || !file.type.startsWith('image/')) return;
  try {
    const prepared = await prepareImage(file);
    const fit = Math.min(1, 320 / prepared.naturalWidth, 320 / prepared.naturalHeight);
    const displayW = Math.round(prepared.naturalWidth * fit);
    const displayH = Math.round(prepared.naturalHeight * fit);
    const rect = boardRect();
    const center = staggerPoint(
      screenToWorld(rect.left + rect.width / 2, rect.top + rect.height / 2),
      offset
    );

    const item = {
      type: 'image',
      x: center.x,
      y: center.y,
      width: displayW + 20,
      height: displayH + 48,
      rotation: Math.floor(Math.random() * 5) - 2,
      z: nextZ(),
      imageBase64: prepared.dataUrl.split(',')[1] || prepared.dataUrl,
      mime: prepared.mime,
      filename: file.name,
      retro: true,
      caption: '',
    };

    const created = await api(`/api/items?slot=${state.currentSlot}`, { method: 'POST', body: JSON.stringify(item) });
    imageCache.set(created.id, prepared.dataUrl);
    addLocalItem(created);
    select(created.id);
  } catch (err) {
    console.warn(err);
    alert('Could not add image: ' + err.message);
  }
}

async function addTextFileAsNote(file, offset = 0) {
  try {
    const text = await file.text();
    const rect = boardRect();
    const point = staggerPoint(
      screenToWorld(rect.left + rect.width / 2, rect.top + rect.height / 2),
      offset
    );
    await createNote(point, text, false);
  } catch (err) {
    console.warn(err);
    alert('Could not read text file: ' + err.message);
  }
}

async function handleFiles(files) {
  let offset = 0;
  for (const file of files) {
    if (file.type.startsWith('image/')) await addImageFile(file, offset);
    else if (file.type === 'text/plain' || /\.txt$/i.test(file.name)) await addTextFileAsNote(file, offset);
    else continue;
    offset++;
  }
}

// ---------- strings ----------

async function handleStringClick(id) {
  if (!state.pendingLinkFrom) {
    state.pendingLinkFrom = id;
    renderAll();
    return;
  }
  if (state.pendingLinkFrom === id) {
    state.pendingLinkFrom = null;
    renderAll();
    return;
  }
  try {
    const link = await api(`/api/links?slot=${state.currentSlot}`, {
      method: 'POST',
      body: JSON.stringify({ a: state.pendingLinkFrom, b: id }),
    });
    if (link.removed) {
      state.links = state.links.filter((existing) => existing.id !== link.id);
    } else if (link.id) {
      state.links.push(link);
    }
  } catch (err) {
    console.warn(err);
  }
  state.pendingLinkFrom = id; // keep the last item highlighted so strings can be chained
  renderAll();
  maybeCommitHistory();
}

function toggleTape(id) {
  const item = state.items.get(id);
  if (!item) return;
  item.taped = !item.taped;
  renderItem(item);
  saveItem(item);
}

// ---------- interactions ----------

function onItemPointerDown(e) {
  const el = e.currentTarget;
  const id = el.dataset.id;
  e.stopPropagation();

  if (state.selectedIds.size > 0) {
    if (e.button !== 0) return;
    e.preventDefault();
    const origins = [];
    for (const selectedId of state.selectedIds) {
      const selectedItem = state.items.get(selectedId);
      if (selectedItem && !selectedItem.taped) {
        origins.push({ item: selectedItem, x: selectedItem.x, y: selectedItem.y });
      }
    }
    if (!origins.length) return;
    drag = { kind: 'move-group', startX: e.clientX, startY: e.clientY, origins };
    return;
  }

  if (state.tool === 'string') {
    handleStringClick(id);
    return;
  }
  if (state.tool === 'tape') {
    if (e.button === 0) toggleTape(id);
    return;
  }
  if (e.button !== 0) return;

  e.preventDefault();
  select(id);
  const item = state.items.get(id);
  if (item.taped) return; // taped down: selectable, but not movable

  drag = {
    kind: 'move',
    id,
    startX: e.clientX,
    startY: e.clientY,
    itemX: item.x,
    itemY: item.y,
  };
}

function onHandlePointerDown(e) {
  e.stopPropagation();
  e.preventDefault();
  if (state.selectedIds.size > 0) return;
  const id = e.currentTarget.parentElement.dataset.id;
  select(id);
  const item = state.items.get(id);
  if (item.taped) return;

  const center = worldToScreen(item.x, item.y);
  drag = {
    kind: 'rotate',
    id,
    cx: center.x,
    cy: center.y,
    startAngle: Math.atan2(e.clientY - center.y, e.clientX - center.x) - (item.rotation * Math.PI) / 180,
  };
}

function onResizePointerDown(e) {
  e.stopPropagation();
  e.preventDefault();
  if (state.selectedIds.size > 0) return;
  const id = e.currentTarget.parentElement.dataset.id;
  select(id);
  const item = state.items.get(id);
  if (item.taped) return;

  drag = { kind: 'resize', id, startX: e.clientX, startWidth: item.width };
}

board.addEventListener('pointerdown', (e) => {
  if (e.target.closest('#toolbar') || e.target.closest('#confirm-bar') || e.target.closest('#selection-box')) return;
  if (e.button !== 0) return;

  if (state.tool === 'note') {
    createNote(screenToWorld(e.clientX, e.clientY));
    return;
  }
  if (state.tool === 'string') {
    state.pendingLinkFrom = null;
    renderAll();
    return;
  }
  if (state.editingId) {
    const el = state.els.get(state.editingId);
    const field = el && el.querySelector('textarea, .image-caption');
    if (field) field.blur();
  }
  state.pendingLinkFrom = null;

  if (state.tool === 'select') {
    drag = { kind: 'select', startX: e.clientX, startY: e.clientY, endX: e.clientX, endY: e.clientY, moved: false };
    return;
  }
  clearSelection();
});

window.addEventListener('pointerdown', (e) => {
  if (e.button !== 2) return;
  e.preventDefault();
  document.body.classList.add('panning');
  drag = { kind: 'pan', lastX: e.clientX, lastY: e.clientY };
}, true);

window.addEventListener('pointermove', (e) => {
  if (!drag) return;

  if (drag.kind === 'pan') {
    state.camera.x += e.clientX - drag.lastX;
    state.camera.y += e.clientY - drag.lastY;
    drag.lastX = e.clientX;
    drag.lastY = e.clientY;
    applyCamera();
    scheduleSaveSettings();
    return;
  }

  if (drag.kind === 'select') {
    drag.endX = e.clientX;
    drag.endY = e.clientY;
    if (Math.abs(drag.endX - drag.startX) > 4 || Math.abs(drag.endY - drag.startY) > 4) {
      drag.moved = true;
      const rect = boardRect();
      rubberBand.style.left = `${Math.min(drag.startX, drag.endX) - rect.left}px`;
      rubberBand.style.top = `${Math.min(drag.startY, drag.endY) - rect.top}px`;
      rubberBand.style.width = `${Math.abs(drag.endX - drag.startX)}px`;
      rubberBand.style.height = `${Math.abs(drag.endY - drag.startY)}px`;
      rubberBand.classList.add('active');
    }
    return;
  }

  if (drag.kind === 'move-group') {
    const dx = (e.clientX - drag.startX) / state.camera.scale;
    const dy = (e.clientY - drag.startY) / state.camera.scale;
    for (const origin of drag.origins) {
      origin.item.x = origin.x + dx;
      origin.item.y = origin.y + dy;
      renderItem(origin.item);
    }
    renderStrings();
    return;
  }

  const item = state.items.get(drag.id);
  if (!item) return;

  if (drag.kind === 'move') {
    item.x = drag.itemX + (e.clientX - drag.startX) / state.camera.scale;
    item.y = drag.itemY + (e.clientY - drag.startY) / state.camera.scale;
    renderItem(item);
    renderStrings();
  } else if (drag.kind === 'rotate') {
    let degrees = (Math.atan2(e.clientY - drag.cy, e.clientX - drag.cx) - drag.startAngle) * (180 / Math.PI);
    if (e.shiftKey) degrees = Math.round(degrees / 15) * 15;
    item.rotation = Math.round(degrees);
    renderItem(item);
  } else if (drag.kind === 'resize') {
    const delta = (e.clientX - drag.startX) / state.camera.scale;
    const localDelta = delta * Math.cos((item.rotation * Math.PI) / 180);
    item.width = Math.max(140, Math.round(drag.startWidth + localDelta));
    renderItem(item);
    fitNote(item); // reflow the text at the new width in real time
  }
});

window.addEventListener('pointerup', () => {
  document.body.classList.remove('panning');
  if (!drag) return;

  if (drag.kind === 'select') {
    rubberBand.classList.remove('active');
    if (drag.moved) {
      const minX = Math.min(drag.startX, drag.endX);
      const maxX = Math.max(drag.startX, drag.endX);
      const minY = Math.min(drag.startY, drag.endY);
      const maxY = Math.max(drag.startY, drag.endY);
      const ids = [];
      for (const [id, el] of state.els) {
        const r = el.getBoundingClientRect();
        if (r.right >= minX && r.left <= maxX && r.bottom >= minY && r.top <= maxY) ids.push(id);
      }
      if (ids.length) selectMany(ids);
      else clearSelection();
    } else {
      clearSelection();
    }
  } else if (drag.kind === 'move-group') {
    for (const origin of drag.origins) saveItem(origin.item);
  } else if (drag.kind === 'move' || drag.kind === 'rotate' || drag.kind === 'resize') {
    saveItem(state.items.get(drag.id));
  }

  drag = null;
});

board.addEventListener('wheel', (e) => {
  e.preventDefault();
  zoomAt(Math.exp(-e.deltaY * 0.0015), e.clientX, e.clientY);
}, { passive: false });

board.addEventListener('contextmenu', (e) => e.preventDefault());

// ---------- toolbar ----------

function showHint(duration = 2500) {
  hint.hidden = false;
  clearTimeout(hintTimer);
  hintTimer = setTimeout(() => {
    hint.hidden = true;
  }, duration);
}

function setTool(tool, openPicker = true) {
  const changed = tool !== state.tool;
  hideConfirm();
  state.selectedId = null;
  state.selectedIds.clear();
  state.tool = tool;
  state.pendingLinkFrom = null;
  document.body.dataset.tool = tool;
  document.querySelectorAll('.tool').forEach((button) => {
    button.classList.toggle('active', button.dataset.tool === tool);
  });
  hint.innerHTML = HINTS[tool];
  if (changed) showHint();
  if (tool === 'image' && openPicker) fileInput.click();
  renderAll();
}

document.querySelectorAll('.tool').forEach((button) => {
  button.addEventListener('click', () => setTool(button.dataset.tool));
  button.addEventListener('mouseenter', () => {
    hint.innerHTML = HINTS[button.dataset.tool];
    showHint();
  });
});

document.getElementById('retroToggle').addEventListener('click', (e) => {
  state.globalRetro = !state.globalRetro;
  document.body.classList.toggle('retro-disabled', !state.globalRetro);
  e.currentTarget.title = `Retro: ${state.globalRetro ? 'On' : 'Off'}`;
  e.currentTarget.classList.toggle('on', state.globalRetro);
  e.currentTarget.classList.toggle('off', !state.globalRetro);
  scheduleSaveSettings();
});

document.getElementById('multiDelete').addEventListener('pointerdown', (e) => e.stopPropagation());
document.getElementById('multiDelete').addEventListener('dblclick', (e) => e.stopPropagation());
document.getElementById('multiDelete').addEventListener('click', deleteSelected);

undoButton.addEventListener('click', undo);
redoButton.addEventListener('click', redo);

slotPrev.addEventListener('click', () => {
  if (state.currentSlot > 1) goToSlot(state.currentSlot - 1);
});

slotNext.addEventListener('click', () => {
  const atLast = state.currentSlot >= state.slotCount;
  if (atLast && state.items.size === 0) return;
  if (atLast) state.slotCount += 1;
  goToSlot(state.currentSlot + 1);
});

clearBoardButton.addEventListener('click', () => {
  askConfirm('Delete everything on current board?', clearCurrentBoard);
});


function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function downloadSelected() {
  const id = state.selectedId;
  if (!id || state.selectedIds.size) return;
  const item = state.items.get(id);
  if (!item) return;

  try {
    if (item.type === 'note') {
      const blob = new Blob([item.text || ''], { type: 'text/plain;charset=utf-8' });
      triggerDownload(blob, `note-${id.slice(0, 8)}.txt`);
      return;
    }

    const response = await fetch(`/api/items/${id}/image`);
    if (!response.ok) throw new Error('Could not fetch image');
    const blob = await response.blob();
    const fallbackExt = (item.mime || 'image/png').split('/')[1] || 'png';
    const name = item.filename || `image-${id.slice(0, 8)}.${fallbackExt}`;
    triggerDownload(blob, name);
  } catch (err) {
    console.warn(err);
    alert('Could not download: ' + err.message);
  }
}

function hideConfirm() {
  pendingAction = null;
  confirmBar.hidden = true;
}

function askConfirm(message, action) {
  pendingAction = action;
  confirmMessage.textContent = message;
  clearTimeout(hintTimer);
  hint.hidden = true;
  confirmBar.hidden = false;
}

async function runConfirm() {
  const action = pendingAction;
  hideConfirm();
  if (action) await action();
}

function deleteSelected() {
  const ids = state.selectedIds.size
    ? [...state.selectedIds]
    : state.selectedId
      ? [state.selectedId]
      : [];
  if (!ids.length) return;

  const item = state.items.get(ids[0]);
  const label = item && item.type === 'note' ? 'note' : 'photo';
  askConfirm(
    ids.length === 1 ? `Delete this ${label}?` : `Delete ${ids.length} items?`,
    () => performDelete(ids)
  );
}

async function performDelete(ids) {
  try {
    await Promise.all(ids.map((id) => cacheImage(state.items.get(id))));
    await Promise.all(ids.map((id) => api(`/api/items/${id}?slot=${state.currentSlot}`, { method: 'DELETE' })));
    for (const id of ids) {
      state.items.delete(id);
      const el = state.els.get(id);
      if (el) el.remove();
      state.els.delete(id);
    }
    state.links = state.links.filter((link) => !ids.includes(link.a) && !ids.includes(link.b));
    state.selectedId = null;
    state.selectedIds.clear();
    state.editingId = null;
    renderAll();
    maybeCommitHistory();
  } catch (err) {
    console.warn(err);
  }
}

async function clearCurrentBoard() {
  try {
    await Promise.all([...state.items.values()].map((item) => cacheImage(item)));
    await api(`/api/boards/${state.currentSlot}/clear`, { method: 'DELETE' });
    for (const el of state.els.values()) el.remove();
    state.els.clear();
    state.items.clear();
    state.links = [];
    state.selectedId = null;
    state.selectedIds.clear();
    state.editingId = null;
    renderAll();
    maybeCommitHistory();
  } catch (err) {
    console.warn(err);
    alert('Could not clear the board: ' + err.message);
  }
}

document.getElementById('confirm-yes').addEventListener('click', runConfirm);
document.getElementById('confirm-no').addEventListener('click', hideConfirm);

fileInput.addEventListener('change', () => {
  handleFiles([...fileInput.files]);
  fileInput.value = '';
});

board.addEventListener('dragover', (e) => {
  e.preventDefault();
  board.classList.add('drag-over');
});
board.addEventListener('dragleave', () => board.classList.remove('drag-over'));
board.addEventListener('drop', (e) => {
  e.preventDefault();
  board.classList.remove('drag-over');
  handleFiles([...e.dataTransfer.files]);
});

window.addEventListener('keydown', (e) => {
  if (e.ctrlKey && !e.altKey && !e.metaKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
    e.preventDefault();
    const tools = ['select', 'note', 'image', 'string', 'tape'];
    const index = tools.indexOf(state.tool);
    const step = e.key === 'ArrowRight' ? 1 : -1;
    const next = tools[(index + step + tools.length) % tools.length];
    setTool(next, false);
    document.querySelector(`.tool[data-tool="${next}"]`).focus();
    return;
  }

  if (e.ctrlKey && !e.altKey && !e.metaKey && (e.key.toLowerCase() === 'z' || e.key.toLowerCase() === 'y')) {
    e.preventDefault();
    if (e.key.toLowerCase() === 'y' || e.shiftKey) redo();
    else undo();
    return;
  }

  if (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT' || e.target.isContentEditable) {
    if (e.key === 'Escape') e.target.blur();
    return;
  }
  const key = e.key.toLowerCase();
  if (key === 'v') setTool('select');
  else if (key === 'n') setTool('note');
  else if (key === 'i') setTool('image');
  else if (key === 's') setTool('string');
  else if (key === 't') setTool('tape');
  else if (key === '+' || key === '=') zoomFromCenter(1.2);
  else if (key === '-') zoomFromCenter(1 / 1.2);
  else if (key === '0') {
    state.camera = { x: 0, y: 0, scale: 1 };
    applyCamera();
    scheduleSaveSettings();
  } else if (e.key === 'Delete' || e.key === 'Backspace') {
    e.preventDefault();
    deleteSelected();
  } else if (e.key === 'Escape') {
    if (!confirmBar.hidden) {
      hideConfirm();
      return;
    }
    state.pendingLinkFrom = null;
    clearSelection();
  }
});

// ---------- boot ----------

async function init() {
  try {
    if (document.fonts && document.fonts.ready) await document.fonts.ready;
    const first = await api('/api/board?slot=1');
    const slotCount = Math.max(1, Number(first.settings.slotCount) || 1);
    const lastSlot = Math.max(1, Number(first.settings.lastSlot) || 1);
    const target = Math.min(slotCount, lastSlot);
    await loadSlot(target, target === 1 ? first : null);
  } catch (err) {
    console.error(err);
    hint.textContent = 'Could not load the board. Is the server running?';
    hint.hidden = false;
  }
}

init();
