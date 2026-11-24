# The Board — serverless edition

A movie-style detective board that runs **entirely in the browser**. No server, no install, no build step: SQLite runs in a WebAssembly sandbox (sql.js), so your board stays an ordinary `.db` file that you own.

For the hosted, server-owned database version, see the `main` branch.

## Use it

Open `index.html` directly from disk (double-click it), or upload this folder to any static host. Then:

1. Click **Open .db** and choose your board's SQLite file.
2. Use the board normally — notes, photos, strings, tape, captions, multiple boards, undo/redo, camera and Retro filter. Touch and trackpad controls are included.
3. Click **Download .db** to save the updated, self-contained SQLite file.

Changes are also checkpointed into IndexedDB while you work, so reloading the page offers **Resume saved copy**. That is only a browser cache; the downloaded file is the real artifact. Only one browser session should edit a file at a time — downloads are last-write-wins.

## Layout

```
index.html    the page and all UI markup
css/          styles, including the file controls
js/           board modules (core, api, camera, persistence, history,
              board, render, items, interactions, toolbar, actions, main)
              plus local-db.js (browser SQLite) and standalone-ui.js
vendor/       bundled sql.js, WASM embedded as base64 for file:// use
assets/       fonts
```

The `js/` board modules are shared with `main`. They are classic scripts rather than ES modules so that opening `index.html` straight from disk works in every browser (ES module imports are blocked by `file://` CORS rules).

## Preparing an existing database

Databases made by older versions used WAL mode, where recent changes live in a `board.db-wal` sibling. Opening only `board.db` would silently miss those changes. Stop the server cleanly first — SQLite normally folds the WAL into the main file when its last connection closes. If a `-wal` file still remains, checkpoint it with any SQLite tool (`PRAGMA wal_checkpoint(TRUNCATE)` and `PRAGMA journal_mode = DELETE`). Files downloaded from this app are always self-contained.

## Limits

- The entire database is loaded into browser memory. Peak usage is roughly **3–4× the file size**. Up to ~100 MB is comfortable; past ~500 MB opening and exporting become slow and memory-hungry; around 1 GB is unreliable.
- Images are stored unscaled, so downscale photos before adding them if you expect many.
- IndexedDB availability on `file://` varies by browser; if it is blocked, the app still works — you just lose the automatic local copy.
- Undo/redo is session-only and capped at 30 steps.

sql.js is MIT licensed — see `vendor/LICENSE`.
