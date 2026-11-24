/*
 * Glue for the standalone (no-server) build: loads sql.js, opens a .db file,
 * swaps the network API for the local one, and handles save/download.
 */
(function () {
  'use strict';

  let SQL = null;
  let board = null;
  let boot = null;
  let fileName = 'board.db';
  let saveTimer = null;
  const imageUrls = new Map();

  const el = (id) => document.getElementById(id);

  // app.js calls this instead of init() so nothing loads before a DB is open.
  window.BOARD_BOOT = function (fn) { boot = fn; };

  async function ensureSQL() {
    if (SQL) return SQL;
    if (!window.initSqlJs || !window.SQL_WASM_BASE64) throw new Error('sql.js did not load');
    const binary = Uint8Array.from(atob(window.SQL_WASM_BASE64), (c) => c.charCodeAt(0));
    SQL = await window.initSqlJs({ wasmBinary: binary });
    return SQL;
  }

  function setStatus(text) {
    const node = el('db-status');
    if (node) node.textContent = text;
  }

  function updateStatus() {
    if (!board) return;
    const stats = board.stats();
    setStatus(`${fileName} — ${stats.items} items, ${stats.links} strings. Changes are kept in this browser.`);
  }

  function clearImageUrls() {
    imageUrls.forEach((url) => URL.revokeObjectURL(url));
    imageUrls.clear();
  }

  async function openFile(file) {
    setStatus(`Opening ${file.name}…`);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const sql = await ensureSQL();
      clearImageUrls();
      board = window.LocalBoard.createBoardApi(sql, bytes);
      fileName = file.name;
      el('downloadDb').disabled = false;
      el('db-controls').classList.add('has-db');
      if (!boot) throw new Error('Board UI did not initialise');
      await boot();
      updateStatus();
      scheduleSave();
    } catch (err) {
      console.error(err);
      setStatus(`Could not open: ${err.message}`);
      alert(`Could not open that database file: ${err.message}`);
    }
  }

  function downloadDb() {
    if (!board) return;
    setStatus('Preparing download…');
    // Let the status paint before the export blocks the main thread.
    requestAnimationFrame(() => {
      try {
        const bytes = board.exportBytes();
        const blob = new Blob([bytes], { type: 'application/x-sqlite3' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = fileName.replace(/\.db.*$/i, '') + '-edited.db';
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        setStatus(`Downloaded ${link.download}.`);
      } catch (err) {
        console.error(err);
        setStatus(`Download failed: ${err.message}`);
      }
    });
  }

  // ---- optional local persistence (IndexedDB is a cache, not a file) ----

  const DB_NAME = 'detective-board-standalone';
  const STORE = 'snapshots';

  function openIdb() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(STORE);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async function saveSnapshot() {
    if (!board) return;
    const db = await openIdb();
    const bytes = board.exportBytes();
    await new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE, 'readwrite');
      transaction.objectStore(STORE).put(new Blob([bytes], { type: 'application/x-sqlite3' }), 'last');
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
    });
    db.close();
  }

  async function readSnapshot() {
    const db = await openIdb();
    const blob = await new Promise((resolve, reject) => {
      const request = db.transaction(STORE, 'readonly').objectStore(STORE).get('last');
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
    db.close();
    return blob;
  }

  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveSnapshot().catch((err) => console.warn('Could not save local copy:', err));
    }, 1500);
  }

  // ---- wire up once the DOM is ready (and after app.js defined its globals) ----

  document.addEventListener('DOMContentLoaded', async () => {
    window.api = async (url, options = {}) => {
      if (!board) throw new Error('Open a database file first');
      const result = await board.api(url, options);
      if ((options.method || 'GET').toUpperCase() !== 'GET') scheduleSave();
      updateStatus();
      return result;
    };

    window.boardImageUrl = (id) => {
      if (!board) return '';
      if (!imageUrls.has(id)) {
        const blob = board.imageBlob(id);
        if (!blob) return '';
        imageUrls.set(id, URL.createObjectURL(blob));
      }
      return imageUrls.get(id);
    };

    window.boardImageFetch = (id) => {
      const blob = board && board.imageBlob(id);
      return Promise.resolve({ ok: !!blob, blob: async () => blob });
    };

    el('openDb').addEventListener('click', () => el('dbFileInput').click());
    el('dbFileInput').addEventListener('change', (event) => {
      const file = event.target.files && event.target.files[0];
      if (file) openFile(file);
      event.target.value = '';
    });
    el('downloadDb').addEventListener('click', downloadDb);

    try {
      const saved = await readSnapshot();
      if (saved) el('resumeDb').hidden = false;
    } catch (err) {
      console.warn('IndexedDB unavailable:', err);
    }
    el('resumeDb').addEventListener('click', () => {
      readSnapshot().then((blob) => {
        if (blob) return openFile(new File([blob], 'board-restored.db', { type: 'application/x-sqlite3' }));
      }).catch((err) => setStatus(`Could not restore: ${err.message}`));
    });

    setStatus('Choose a board .db file to begin.');
  });
})();
