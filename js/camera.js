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

function setZoomAt(nextScale, clientX, clientY) {
  const rect = boardRect();
  const sx = clientX - rect.left;
  const sy = clientY - rect.top;
  const wx = (sx - state.camera.x) / state.camera.scale;
  const wy = (sy - state.camera.y) / state.camera.scale;
  const next = Math.min(3, Math.max(0.25, nextScale));

  state.camera.scale = next;
  state.camera.x = sx - wx * next;
  state.camera.y = sy - wy * next;

  applyCamera();
  scheduleSaveSettings();
}

function zoomAt(factor, clientX, clientY) {
  setZoomAt(state.camera.scale * factor, clientX, clientY);
}

// Moves the board content by dx/dy on screen (positive dx = content goes right).
function panBy(dx, dy) {
  state.camera.x += dx;
  state.camera.y += dy;
  applyCamera();
  scheduleSaveSettings();
}

function pointerPair() {
  const points = [...activePointers.values()];
  return points.length >= 2 ? [points[0], points[1]] : null;
}

function pointDistance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function pointMidpoint(a, b) {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
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
