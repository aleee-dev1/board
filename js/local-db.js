/*
 * Browser-side replacement for server.js + db.js.
 *
 * It speaks the same API contract as the Express server (same URLs, same
 * response shapes) but runs every query against a sql.js in-memory database.
 * This file is plain UMD so it can also be required from Node for tests.
 */
(function (root, factory) {
  const mod = factory();
  if (typeof module === 'object' && module.exports) module.exports = mod;
  if (root) root.LocalBoard = mod;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function uuid() {
    if (globalThis.crypto && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = Math.random() * 16 | 0;
      return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
  }

  function num(value, fallback) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  }

  function base64ToBytes(base64) {
    const clean = String(base64).replace(/^data:[^;]+;base64,/, '');
    const binary = atob(clean);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  function createBoardApi(SQL, fileBytes) {
    const db = new SQL.Database(fileBytes);

    // A standalone file must be self-contained: no -wal / -shm siblings.
    // A WAL-mode database that still has an uncheckpointed -wal file will
    // read as stale here; see README for the one-time prepare step.
    try { db.run('PRAGMA journal_mode = DELETE'); } catch (err) { /* best effort */ }
    db.run('PRAGMA foreign_keys = ON');

    function all(sql, params = []) {
      const statement = db.prepare(sql);
      try {
        statement.bind(params);
        const rows = [];
        while (statement.step()) rows.push(statement.getAsObject());
        return rows;
      } finally {
        statement.free();
      }
    }

    function get(sql, params = []) {
      const rows = all(sql, params);
      return rows.length ? rows[0] : null;
    }

    function run(sql, params = []) {
      db.run(sql, params);
    }

    // ---- schema (kept in sync with db.js) ----

    db.exec(`
      CREATE TABLE IF NOT EXISTS items (
        id         TEXT PRIMARY KEY,
        type       TEXT NOT NULL CHECK(type IN ('note', 'image')),
        x          REAL NOT NULL DEFAULT 0,
        y          REAL NOT NULL DEFAULT 0,
        width      REAL NOT NULL DEFAULT 190,
        height     REAL NOT NULL DEFAULT 150,
        rotation   REAL NOT NULL DEFAULT 0,
        z          REAL NOT NULL DEFAULT 0,
        text       TEXT,
        color      TEXT,
        retro      INTEGER NOT NULL DEFAULT 1,
        taped      INTEGER NOT NULL DEFAULT 0,
        caption    TEXT,
        filename   TEXT,
        mime       TEXT,
        image      BLOB,
        slot       INTEGER NOT NULL DEFAULT 1,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS links (
        id         TEXT PRIMARY KEY,
        a          TEXT NOT NULL,
        b          TEXT NOT NULL,
        slot       INTEGER NOT NULL DEFAULT 1,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (a) REFERENCES items(id) ON DELETE CASCADE,
        FOREIGN KEY (b) REFERENCES items(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS settings (
        key   TEXT PRIMARY KEY,
        value TEXT
      );
    `);

    const itemColumns = all('PRAGMA table_info(items)').map((column) => column.name);
    if (!itemColumns.includes('taped')) run('ALTER TABLE items ADD COLUMN taped INTEGER NOT NULL DEFAULT 0');
    if (!itemColumns.includes('caption')) run('ALTER TABLE items ADD COLUMN caption TEXT');
    if (!itemColumns.includes('filename')) run('ALTER TABLE items ADD COLUMN filename TEXT');
    if (!itemColumns.includes('slot')) run('ALTER TABLE items ADD COLUMN slot INTEGER NOT NULL DEFAULT 1');
    run('UPDATE items SET slot = 1 WHERE slot IS NULL OR slot = 0');

    const linkColumns = all('PRAGMA table_info(links)').map((column) => column.name);
    if (!linkColumns.includes('slot')) run('ALTER TABLE links ADD COLUMN slot INTEGER NOT NULL DEFAULT 1');
    run('UPDATE links SET slot = 1 WHERE slot IS NULL OR slot = 0');

    for (const key of ['camera', 'retro']) {
      const row = get('SELECT value FROM settings WHERE key = ?', [key]);
      if (row) {
        setSetting(`board:1:${key}`, JSON.parse(row.value));
        run('DELETE FROM settings WHERE key = ?', [key]);
      }
    }
    run("INSERT OR IGNORE INTO settings (key, value) VALUES ('slotCount', '1')");
    run("INSERT OR IGNORE INTO settings (key, value) VALUES ('lastSlot', '1')");

    // ---- helpers ----

    function getSetting(key, fallback) {
      const row = get('SELECT value FROM settings WHERE key = ?', [key]);
      if (!row || row.value === null || row.value === undefined) return fallback;
      try { return JSON.parse(row.value); } catch { return row.value; }
    }

    function setSetting(key, value) {
      run(
        `INSERT INTO settings (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
        [key, JSON.stringify(value)]
      );
    }

    function nextZ(slot) {
      const row = get('SELECT MAX(z) AS z FROM items WHERE slot = ?', [slot]);
      return num(row && row.z, 0) + 1;
    }

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
      if (row.type === 'image') out.imageUrl = ''; // filled in by the UI layer
      return out;
    }

    function board(slot) {
      const rows = all('SELECT * FROM items WHERE slot = ? ORDER BY z ASC, created_at ASC', [slot]);
      const links = all('SELECT id, a, b FROM links WHERE slot = ?', [slot]);
      const camera = getSetting(`board:${slot}:camera`, { x: 0, y: 0, scale: 1 });
      const retro = getSetting(`board:${slot}:retro`, true);
      const slotCount = getSetting('slotCount', 1);
      const lastSlot = getSetting('lastSlot', 1);
      return {
        items: rows.map(toPublic),
        links,
        settings: {
          camera,
          retro,
          slotCount: Math.max(1, num(slotCount, 1)),
          lastSlot: Math.max(1, num(lastSlot, 1)),
        },
        slot,
      };
    }

    // ---- the API ----

    async function api(url, options = {}) {
      const parsed = new URL(url, 'http://local/');
      const path = parsed.pathname;
      const body = options.body ? JSON.parse(options.body) : {};
      const method = (options.method || 'GET').toUpperCase();
      const rawSlot = parsed.searchParams.get('slot') ?? body.slot;
      const slotNumber = num(rawSlot, 1);
      const slot = Number.isInteger(slotNumber) && slotNumber > 0 ? slotNumber : 1;

      if (method === 'GET' && path === '/api/board') return board(slot);

      if (method === 'POST' && path === '/api/items') {
        if (body.type !== 'note' && body.type !== 'image') throw new Error('type must be "note" or "image"');
        let image = null;
        let mime = null;
        if (body.type === 'image') {
          if (typeof body.imageBase64 !== 'string' || typeof body.mime !== 'string' || !body.mime.startsWith('image/')) {
            throw new Error('invalid image payload');
          }
          image = base64ToBytes(body.imageBase64);
          if (!image.length) throw new Error('empty image');
          mime = body.mime;
        }
        const id = /^[0-9a-f-]{36}$/i.test(String(body.id || '')) ? body.id : uuid();
        const item = {
          id,
          type: body.type,
          x: num(body.x, 0),
          y: num(body.y, 0),
          width: num(body.width, body.type === 'note' ? 190 : 300),
          height: num(body.height, body.type === 'note' ? 150 : 300),
          rotation: num(body.rotation, 0),
          z: num(body.z, nextZ(slot)),
          text: body.type === 'note' ? String(body.text ?? '') : null,
          color: body.type === 'note' ? String(body.color ?? '#f6e6a8') : null,
          retro: body.retro === false ? 0 : 1,
          taped: body.taped ? 1 : 0,
          caption: body.type === 'image' ? String(body.caption ?? '') : null,
          filename: body.type === 'image' ? String(body.filename ?? '') : null,
          mime,
          image,
          slot,
        };
        run(
          `INSERT INTO items
            (id, type, x, y, width, height, rotation, z, text, color, retro, taped, caption, filename, mime, image, slot)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [item.id, item.type, item.x, item.y, item.width, item.height, item.rotation,
            item.z, item.text, item.color, item.retro, item.taped, item.caption, item.filename, item.mime, item.image, item.slot]
        );
        return toPublic(get('SELECT * FROM items WHERE id = ?', [id]));
      }

      const itemMatch = path.match(/^\/api\/items\/([^/]+)$/);
      if (itemMatch) {
        const id = itemMatch[1];
        if (method === 'PATCH') {
          const existing = get('SELECT * FROM items WHERE id = ? AND slot = ?', [id, slot]);
          if (!existing) throw new Error('item not found');
          const allowed = ['x', 'y', 'width', 'height', 'rotation', 'z', 'text', 'color', 'retro', 'taped', 'caption'];
          const numeric = new Set(['x', 'y', 'width', 'height', 'rotation', 'z']);
          const booleans = new Set(['retro', 'taped']);
          const sets = [];
          const values = [];
          for (const key of allowed) {
            if (!(key in body)) continue;
            let value = body[key];
            if (booleans.has(key)) value = value ? 1 : 0;
            else if (numeric.has(key)) {
              value = num(value, null);
              if (value === null) continue;
            } else value = String(value ?? '');
            sets.push(`${key} = ?`);
            values.push(value);
          }
          if (sets.length) {
            sets.push('updated_at = CURRENT_TIMESTAMP');
            values.push(id, slot);
            run(`UPDATE items SET ${sets.join(', ')} WHERE id = ? AND slot = ?`, values);
          }
          return toPublic(get('SELECT * FROM items WHERE id = ?', [id]));
        }
        if (method === 'DELETE') {
          const existing = get('SELECT id FROM items WHERE id = ? AND slot = ?', [id, slot]);
          if (!existing) throw new Error('item not found');
          run('DELETE FROM links WHERE a = ? OR b = ?', [id, id]);
          run('DELETE FROM items WHERE id = ? AND slot = ?', [id, slot]);
          return { ok: true };
        }
      }

      if (method === 'POST' && path === '/api/links') {
        const { a, b } = body;
        if (!a || !b || a === b) throw new Error('two different items required');
        const itemA = get('SELECT id FROM items WHERE id = ? AND slot = ?', [a, slot]);
        const itemB = get('SELECT id FROM items WHERE id = ? AND slot = ?', [b, slot]);
        if (!itemA || !itemB) throw new Error('unknown item');
        const existing = all('SELECT id, a, b FROM links WHERE slot = ?', [slot]).find(
          (link) => (link.a === a && link.b === b) || (link.a === b && link.b === a)
        );
        if (existing) {
          run('DELETE FROM links WHERE id = ? AND slot = ?', [existing.id, slot]);
          return { id: existing.id, a, b, removed: true };
        }
        const id = /^[0-9a-f-]{36}$/i.test(String(body.id || '')) ? body.id : uuid();
        run('INSERT INTO links (id, a, b, slot) VALUES (?, ?, ?, ?)', [id, a, b, slot]);
        return { id, a, b, slot };
      }

      const linkMatch = path.match(/^\/api\/links\/([^/]+)$/);
      if (method === 'DELETE' && linkMatch) {
        const existing = get('SELECT id FROM links WHERE id = ? AND slot = ?', [linkMatch[1], slot]);
        if (!existing) throw new Error('link not found');
        run('DELETE FROM links WHERE id = ? AND slot = ?', [linkMatch[1], slot]);
        return { ok: true };
      }

      const clearMatch = path.match(/^\/api\/boards\/([^/]+)\/clear$/);
      if (method === 'DELETE' && clearMatch) {
        const clearSlot = num(clearMatch[1], 1);
        run('DELETE FROM links WHERE slot = ?', [clearSlot]);
        run('DELETE FROM items WHERE slot = ?', [clearSlot]);
        return { ok: true };
      }

      if (method === 'PATCH' && path === '/api/settings') {
        for (const [key, value] of Object.entries(body)) {
          if (key === 'slotCount' || key === 'lastSlot') setSetting(key, num(value, 1));
          else if (key === 'camera') setSetting(`board:${slot}:camera`, value);
          else if (key === 'retro') setSetting(`board:${slot}:retro`, !!value);
        }
        return { ok: true };
      }

      throw new Error(`Unknown endpoint: ${method} ${path}`);
    }

    function imageBlob(id) {
      const row = get('SELECT mime, image FROM items WHERE id = ?', [id]);
      if (!row || !row.image) return null;
      return new Blob([row.image], { type: row.mime || 'application/octet-stream' });
    }

    function exportBytes() {
      try { db.run('VACUUM'); } catch (err) { /* non-fatal */ }
      return db.export();
    }

    function stats() {
      return {
        items: num(get('SELECT COUNT(*) AS n FROM items')?.n, 0),
        links: num(get('SELECT COUNT(*) AS n FROM links')?.n, 0),
      };
    }

    return { db, api, imageBlob, exportBytes, stats, close: () => db.close() };
  }

  return { createBoardApi, base64ToBytes };
});
