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
document.getElementById('multiDelete').addEventListener('click', () => deleteSelected());

undoButton.addEventListener('click', () => undo());
redoButton.addEventListener('click', () => redo());

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
