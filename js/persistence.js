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
