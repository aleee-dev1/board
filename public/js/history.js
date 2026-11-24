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
