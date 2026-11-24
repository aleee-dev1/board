// ---------- interactions ----------

function onItemPointerDown(e) {
  const el = e.currentTarget;
  const id = el.dataset.id;
  e.stopPropagation();
  clearTimeout(longPressTimer);
  if (activePointers.size >= 2) return; // second finger: pinch takes priority

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
  if (e.pointerType === 'touch' && activePointers.size >= 2) return;
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
    if (e.pointerType === 'touch') {
      clearTimeout(longPressTimer);
      drag = {
        kind: 'touch-pan',
        startX: e.clientX,
        startY: e.clientY,
        lastX: e.clientX,
        lastY: e.clientY,
        moved: false,
      };
      longPressTimer = setTimeout(() => {
        if (!drag || drag.kind !== 'touch-pan') return;
        drag = { kind: 'select', startX: e.clientX, startY: e.clientY, endX: e.clientX, endY: e.clientY, moved: false };
        const origin = boardRect();
        rubberBand.style.left = `${e.clientX - origin.left}px`;
        rubberBand.style.top = `${e.clientY - origin.top}px`;
        rubberBand.style.width = '1px';
        rubberBand.style.height = '1px';
        rubberBand.classList.add('active');
        if (navigator.vibrate) navigator.vibrate(15);
      }, 400);
      if (!touchHintShown) {
        touchHintShown = true;
        hint.innerHTML = 'Drag to pan &middot; hold to select an area &middot; pinch to zoom';
        showHint(3000);
      }
      return;
    }
    drag = { kind: 'select', startX: e.clientX, startY: e.clientY, endX: e.clientX, endY: e.clientY, moved: false };
    return;
  }
  clearSelection();
});

window.addEventListener('pointerdown', (e) => {
  if (e.pointerType === 'touch') {
    if (e.target.closest('#toolbar, #confirm-bar, #selection-box')) return;
    activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (activePointers.size >= 2) {
      clearTimeout(longPressTimer);
      const pair = pointerPair();
      const middle = pointMidpoint(pair[0], pair[1]);
      const world = screenToWorld(middle.x, middle.y);
      drag = {
        kind: 'pinch',
        startDist: Math.max(1, pointDistance(pair[0], pair[1])),
        startScale: state.camera.scale,
        worldX: world.x,
        worldY: world.y,
      };
      return;
    }
  }
  if (e.button !== 2) return;
  e.preventDefault();
  document.body.classList.add('panning');
  drag = { kind: 'pan', lastX: e.clientX, lastY: e.clientY };
}, true);

window.addEventListener('pointermove', (e) => {
  if (e.pointerType === 'touch' && activePointers.has(e.pointerId)) {
    activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  }
  if (!drag) return;

  if (drag.kind === 'pinch') {
    const pair = pointerPair();
    if (!pair) return;
    const distance = Math.max(1, pointDistance(pair[0], pair[1]));
    const scale = Math.min(3, Math.max(0.25, drag.startScale * (distance / drag.startDist)));
    const middle = pointMidpoint(pair[0], pair[1]);
    const origin = boardRect();
    state.camera.scale = scale;
    state.camera.x = (middle.x - origin.left) - drag.worldX * scale;
    state.camera.y = (middle.y - origin.top) - drag.worldY * scale;
    applyCamera();
    scheduleSaveSettings();
    return;
  }

  if (drag.kind === 'touch-pan') {
    const dx = e.clientX - drag.lastX;
    const dy = e.clientY - drag.lastY;
    drag.lastX = e.clientX;
    drag.lastY = e.clientY;
    if (Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) > 8) {
      drag.moved = true;
      clearTimeout(longPressTimer);
    }
    panBy(dx, dy);
    return;
  }

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

function onPointerEnd(e) {
  clearTimeout(longPressTimer);
  if (e.pointerType === 'touch') activePointers.delete(e.pointerId);
  document.body.classList.remove('panning');
  if (!drag) return;

  if (drag.kind === 'pinch') {
    const remaining = [...activePointers.values()];
    if (remaining.length === 1) {
      drag = {
        kind: 'touch-pan',
        startX: remaining[0].x,
        startY: remaining[0].y,
        lastX: remaining[0].x,
        lastY: remaining[0].y,
        moved: true,
      };
      return;
    }
    drag = null;
    return;
  }

  if (drag.kind === 'touch-pan') {
    if (!drag.moved) clearSelection();
    drag = null;
    return;
  }

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
}

window.addEventListener('pointerup', onPointerEnd);
window.addEventListener('pointercancel', onPointerEnd);

board.addEventListener('wheel', (e) => {
  e.preventDefault();

  // Trackpad pinch is delivered as wheel + ctrlKey.
  if (e.ctrlKey) {
    setZoomAt(state.camera.scale * Math.exp(-e.deltaY * 0.01), e.clientX, e.clientY);
    return;
  }

  // Trackpad two-finger scroll pans; a mouse wheel (large or line-based delta) zooms.
  const trackpad = e.deltaMode === 0 && (e.deltaX !== 0 || Math.abs(e.deltaY) < 40);
  if (trackpad) {
    panBy(-e.deltaX, -e.deltaY);
  } else {
    const step = e.deltaMode === 1 ? 0.05 : 0.0015;
    zoomAt(Math.exp(-e.deltaY * step), e.clientX, e.clientY);
  }
}, { passive: false });

board.addEventListener('contextmenu', (e) => e.preventDefault());
