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
