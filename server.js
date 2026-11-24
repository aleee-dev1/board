const express = require('express');
const path = require('path');
const crypto = require('crypto');
const store = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

function toPublic(row) {
  if (!row) return null;
  const out = {
    id: row.id,
    type: row.type,
    x: row.x,
    y: row.y,
    width: row.width,
    height: row.height,
    rotation: row.rotation,
    z: row.z,
    text: row.text ?? '',
    color: row.color ?? '#f6e6a8',
    retro: !!row.retro,
    taped: !!row.taped,
    caption: row.caption ?? '',
    filename: row.filename ?? null,
    mime: row.mime ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
  if (row.type === 'image') out.imageUrl = `/api/items/${row.id}/image`;
  return out;
}

function num(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function validId(value) {
  return typeof value === 'string' && /^[0-9a-f-]{36}$/i.test(value) ? value : null;
}

function slotOf(req) {
  const raw = req.query.slot ?? (req.body && req.body.slot);
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : 1;
}

async function getSetting(key, fallback) {
  const row = await store.get('SELECT value FROM settings WHERE key = ?', [key]);
  if (!row) return fallback;
  try {
    return JSON.parse(row.value);
  } catch {
    return row.value;
  }
}

async function setSetting(key, value) {
  await store.run(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [key, JSON.stringify(value)]
  );
}

async function nextZ(slot) {
  const row = await store.get('SELECT MAX(z) AS z FROM items WHERE slot = ?', [slot]);
  return num(row && row.z, 0) + 1;
}

// Wrap async route handlers so errors reach the error middleware.
function route(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

// ---------- board ----------

app.get('/api/board', route(async (req, res) => {
  const slot = slotOf(req);
  const [rows, links] = await Promise.all([
    store.all('SELECT * FROM items WHERE slot = ? ORDER BY z ASC, created_at ASC', [slot]),
    store.all('SELECT id, a, b FROM links WHERE slot = ?', [slot]),
  ]);

  const [camera, retro, slotCount, lastSlot] = await Promise.all([
    getSetting(`board:${slot}:camera`, { x: 0, y: 0, scale: 1 }),
    getSetting(`board:${slot}:retro`, true),
    getSetting('slotCount', 1),
    getSetting('lastSlot', 1),
  ]);

  res.json({
    items: rows.map(toPublic),
    links,
    settings: {
      camera,
      retro,
      slotCount: Math.max(1, num(slotCount, 1)),
      lastSlot: Math.max(1, num(lastSlot, 1)),
    },
    slot,
  });
}));

// ---------- items ----------

app.post('/api/items', route(async (req, res) => {
  const body = req.body || {};
  if (body.type !== 'note' && body.type !== 'image') {
    return res.status(400).json({ error: 'type must be "note" or "image"' });
  }

  const slot = slotOf(req);
  let imageBuffer = null;
  let mime = null;

  if (body.type === 'image') {
    if (typeof body.imageBase64 !== 'string' || typeof body.mime !== 'string' || !body.mime.startsWith('image/')) {
      return res.status(400).json({ error: 'invalid image payload' });
    }
    const base64 = body.imageBase64.replace(/^data:image\/[^;]+;base64,/, '');
    imageBuffer = Buffer.from(base64, 'base64');
    if (!imageBuffer.length) return res.status(400).json({ error: 'empty image' });
    mime = body.mime;
  }

  const item = {
    id: validId(body.id) || crypto.randomUUID(),
    type: body.type,
    x: num(body.x, 0),
    y: num(body.y, 0),
    width: num(body.width, body.type === 'note' ? 190 : 300),
    height: num(body.height, body.type === 'note' ? 150 : 300),
    rotation: num(body.rotation, 0),
    z: num(body.z, await nextZ(slot)),
    text: body.type === 'note' ? String(body.text ?? '') : null,
    color: body.type === 'note' ? String(body.color ?? '#f6e6a8') : null,
    retro: body.retro === false ? 0 : 1,
    taped: body.taped ? 1 : 0,
    caption: body.type === 'image' ? String(body.caption ?? '') : null,
    filename: body.type === 'image' ? String(body.filename ?? '') : null,
    mime,
    image: imageBuffer,
    slot,
  };

  await store.run(
    `INSERT INTO items
      (id, type, x, y, width, height, rotation, z, text, color, retro, taped, caption, filename, mime, image, slot)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [item.id, item.type, item.x, item.y, item.width, item.height, item.rotation,
      item.z, item.text, item.color, item.retro, item.taped, item.caption, item.filename, item.mime, item.image, item.slot]
  );

  const created = await store.get('SELECT * FROM items WHERE id = ?', [item.id]);
  res.status(201).json(toPublic(created));
}));

app.patch('/api/items/:id', route(async (req, res) => {
  const slot = slotOf(req);
  const existing = await store.get('SELECT * FROM items WHERE id = ? AND slot = ?', [req.params.id, slot]);
  if (!existing) return res.status(404).json({ error: 'item not found' });

  const allowed = ['x', 'y', 'width', 'height', 'rotation', 'z', 'text', 'color', 'retro', 'taped', 'caption'];
  const numeric = new Set(['x', 'y', 'width', 'height', 'rotation', 'z']);
  const booleans = new Set(['retro', 'taped']);
  const sets = [];
  const values = [];

  for (const key of allowed) {
    if (!(key in req.body)) continue;
    let value = req.body[key];
    if (booleans.has(key)) {
      value = value ? 1 : 0;
    } else if (numeric.has(key)) {
      value = num(value, null);
      if (value === null) continue;
    } else {
      value = String(value ?? '');
    }
    sets.push(`${key} = ?`);
    values.push(value);
  }

  if (sets.length) {
    sets.push('updated_at = CURRENT_TIMESTAMP');
    values.push(req.params.id, slot);
    await store.run(`UPDATE items SET ${sets.join(', ')} WHERE id = ? AND slot = ?`, values);
  }

  const updated = await store.get('SELECT * FROM items WHERE id = ?', [req.params.id]);
  res.json(toPublic(updated));
}));

app.delete('/api/items/:id', route(async (req, res) => {
  const slot = slotOf(req);
  const result = await store.run('DELETE FROM items WHERE id = ? AND slot = ?', [req.params.id, slot]);
  if (!result.changes) return res.status(404).json({ error: 'item not found' });
  res.json({ ok: true });
}));

app.get('/api/items/:id/image', route(async (req, res) => {
  const row = await store.get('SELECT mime, image FROM items WHERE id = ?', [req.params.id]);
  if (!row || !row.image) return res.status(404).send('Not found');
  res.type(row.mime || 'application/octet-stream').send(row.image);
}));

// ---------- strings ----------

app.post('/api/links', route(async (req, res) => {
  const slot = slotOf(req);
  const { a, b } = req.body || {};
  if (!a || !b || a === b) return res.status(400).json({ error: 'two different items required' });

  const [itemA, itemB, links] = await Promise.all([
    store.get('SELECT id FROM items WHERE id = ? AND slot = ?', [a, slot]),
    store.get('SELECT id FROM items WHERE id = ? AND slot = ?', [b, slot]),
    store.all('SELECT id, a, b FROM links WHERE slot = ?', [slot]),
  ]);
  if (!itemA || !itemB) return res.status(400).json({ error: 'unknown item' });

  const existing = links.find((link) => (link.a === a && link.b === b) || (link.a === b && link.b === a));
  if (existing) {
    await store.run('DELETE FROM links WHERE id = ? AND slot = ?', [existing.id, slot]);
    return res.status(200).json({ id: existing.id, a, b, removed: true });
  }

  const link = { id: validId(req.body && req.body.id) || crypto.randomUUID(), a, b, slot };
  await store.run('INSERT INTO links (id, a, b, slot) VALUES (?, ?, ?, ?)', [link.id, link.a, link.b, link.slot]);
  res.status(201).json(link);
}));

app.delete('/api/links/:id', route(async (req, res) => {
  const slot = slotOf(req);
  const result = await store.run('DELETE FROM links WHERE id = ? AND slot = ?', [req.params.id, slot]);
  if (!result.changes) return res.status(404).json({ error: 'link not found' });
  res.json({ ok: true });
}));

// ---------- boards ----------

app.delete('/api/boards/:slot/clear', route(async (req, res) => {
  const slot = num(req.params.slot, 1);
  await store.run('DELETE FROM links WHERE slot = ?', [slot]);
  await store.run('DELETE FROM items WHERE slot = ?', [slot]);
  res.json({ ok: true });
}));

// ---------- settings ----------

app.patch('/api/settings', route(async (req, res) => {
  const slot = slotOf(req);
  for (const [key, value] of Object.entries(req.body || {})) {
    if (key === 'slotCount' || key === 'lastSlot') {
      await setSetting(key, num(value, 1));
    } else if (key === 'camera') {
      await setSetting(`board:${slot}:camera`, value);
    } else if (key === 'retro') {
      await setSetting(`board:${slot}:retro`, !!value);
    }
  }
  res.json({ ok: true });
}));

app.use((err, req, res, next) => {
  console.error(err);
  res.status(400).json({ error: err.message || 'Bad request' });
});

store.ready
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Detective board running at http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error('Database setup failed:', err);
    process.exit(1);
  });
