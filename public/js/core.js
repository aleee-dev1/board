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
const activePointers = new Map();
let longPressTimer = null;
let touchHintShown = false;
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
