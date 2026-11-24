// ---------- boot ----------

async function init() {
  try {
    updateDockOffset();
    if (document.fonts && document.fonts.ready) await document.fonts.ready;
    const first = await api('/api/board?slot=1');
    const slotCount = Math.max(1, Number(first.settings.slotCount) || 1);
    const lastSlot = Math.max(1, Number(first.settings.lastSlot) || 1);
    const target = Math.min(slotCount, lastSlot);
    await loadSlot(target, target === 1 ? first : null);
  } catch (err) {
    console.error(err);
    hint.textContent = 'Could not load the board.';
    hint.hidden = false;
  }
}

if (window.BOARD_BOOT) window.BOARD_BOOT(init);
else init();
