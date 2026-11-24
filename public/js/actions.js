
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

    const response = await fetchImage(id);
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
