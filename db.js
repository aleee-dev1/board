const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const dataDir = path.join(__dirname, 'data');
fs.mkdirSync(dataDir, { recursive: true });

// Tests can point this at a throwaway file so the real board is never touched.
const dbPath = process.env.DB_PATH || path.join(dataDir, 'board.db');
const db = new sqlite3.Database(dbPath);

function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows)));
  });
}

function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row)));
  });
}

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

function exec(sql) {
  return new Promise((resolve, reject) => {
    db.exec(sql, (err) => (err ? reject(err) : resolve()));
  });
}

const ready = (async () => {
  await run('PRAGMA journal_mode = WAL');
  await run('PRAGMA foreign_keys = ON');

  await exec(`
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

  // Migrate older single-board databases into slot 1.
  const itemColumns = await all('PRAGMA table_info(items)');
  const itemNames = new Set(itemColumns.map((column) => column.name));
  if (!itemNames.has('taped')) await run('ALTER TABLE items ADD COLUMN taped INTEGER NOT NULL DEFAULT 0');
  if (!itemNames.has('caption')) await run('ALTER TABLE items ADD COLUMN caption TEXT');
  if (!itemNames.has('filename')) await run('ALTER TABLE items ADD COLUMN filename TEXT');
  if (!itemNames.has('slot')) await run('ALTER TABLE items ADD COLUMN slot INTEGER NOT NULL DEFAULT 1');
  await run('UPDATE items SET slot = 1 WHERE slot IS NULL OR slot = 0');

  const linkColumns = await all('PRAGMA table_info(links)');
  if (!linkColumns.some((column) => column.name === 'slot')) {
    await run('ALTER TABLE links ADD COLUMN slot INTEGER NOT NULL DEFAULT 1');
  }
  await run('UPDATE links SET slot = 1 WHERE slot IS NULL OR slot = 0');

  for (const key of ['camera', 'retro']) {
    const row = await get(`SELECT value FROM settings WHERE key = '${key}'`);
    if (row) {
      await run(`INSERT OR REPLACE INTO settings (key, value) VALUES ('board:1:${key}', ?)`, [row.value]);
      await run(`DELETE FROM settings WHERE key = '${key}'`);
    }
  }

  await run("INSERT OR IGNORE INTO settings (key, value) VALUES ('slotCount', '1')");
  await run("INSERT OR IGNORE INTO settings (key, value) VALUES ('lastSlot', '1')");
})();

module.exports = { db, all, get, run, ready };
