# The Board — server edition

A movie-style detective board: cork surface, draggable notes, Polaroid photos and red string. Everything is saved to a single SQLite database on disk, with images stored inside it as BLOBs. This branch runs the board from an Express server — use the `serverless` branch instead if you want a zero-setup static page.

## Run

```bash
npm install
npm start
```

Open <http://localhost:3000>. The server runs in the foreground; stop it with Ctrl+C. Everything is saved automatically to `data/board.db`, with `-wal`/`-shm` siblings while the server is running. Camera position, zoom and the Retro toggle are saved too. Set `DB_PATH=/path/to/other.db` to use a different file.

## Boards

Boards are anonymous slots, like desktop workspaces. The toolbar's last group shows `< 2 >` plus a clear button:

- Left arrow goes back, disabled on board 1.
- Right arrow goes forward. On the last board **with items**, it creates and opens the next empty board; it is disabled if that board is empty.
- The clear button asks "Delete everything on current board?" and empties only the current slot, keeping its camera and Retro settings.

Each slot stores its own items, links, camera and Retro setting in the same SQLite file. Older single-board databases are migrated into slot 1 automatically.

## Trackpad and touch

**Touchpad:** pinch zooms toward the gesture center (Ctrl+wheel); two-finger scroll pans. A mouse wheel zooms toward the cursor — the two are distinguished by delta size/direction.

**Touchscreen:** one finger on an item moves it (or the whole selection); one finger on empty space pans; two fingers pinch-zoom and pan; tap to select/deselect. **Long-press empty space (~400 ms)** opens the marquee selection box. Buttons get larger hit targets on coarse pointers.

## Controls

| Action | How |
| --- | --- |
| Select / move | **Select** tool (V), then left-drag an item |
| Multi-select | With **Select**, drag empty space to rubber-band items. Drag a selected item to move the group; taped items stay put. A dashed box with one trash button appears. Esc or clicking empty space clears it |
| Undo / redo | Toolbar ↶ / ↷ or Ctrl+Z / Ctrl+Shift+Z (Ctrl+Y also redoes). **Session only** — in memory, cleared on refresh and on board switch. Up to 30 steps |
| Rotate | Drag the round handle above a selected item (Shift snaps to 15°) |
| Add note | **Note** tool (N), click the board and type. Double-click a note to edit again |
| Grow / widen note | Notes grow downward as you type; drag the right-edge grip to change width (text reflows live) |
| Add image / text | **Image** tool (I) opens the picker (multi-select allowed), or drop files onto the board. Images become photos; `.txt` files become notes. Several files are staggered |
| Connect / remove string | **String** tool (S), click two items. Clicking the same pair again removes it |
| Tape an item | **Tape** tool (T), click a note or photo. Taped items can't be moved, rotated or resized. Click again to remove |
| Pan | Right-drag anywhere |
| Zoom | Mouse wheel (toward cursor), or `+` / `-` |
| Reset view | `0` |
| Cycle tools | Ctrl+← / Ctrl+→ |
| Add a caption | Double-click a photo and type in the white strip below it |
| Delete | Select, then Delete/Backspace or **Delete** — a Yes/No confirmation bar appears (Esc cancels) |
| Retro filter | Toolbar **Retro** toggle |

## Project layout

```
server.js   Express server and API
db.js       SQLite schema, migrations and helpers
package.json
public/
  index.html    page shell
  css/          styles
  js/           board split into small scripts (core, api, camera,
                persistence, history, board, render, items, interactions,
                toolbar, actions, main)
  assets/       fonts
data/           SQLite database (git-ignored)
```

The frontend is plain classic scripts so the same `js/` modules are shared with the `serverless` branch, which must work when opened directly from disk (ES module imports would break that).

## Stack and storage

- Express (`server.js`), vanilla JS frontend in `public/`, `sqlite3` for storage (`db.js`).
- Images are stored **exactly as uploaded** (no downscaling), with original filenames for downloads. They are served from `/api/items/:id/image`.
- Red strings are an SVG layer inside the transformed world, so they follow the items.
- Retro wear cracks are deterministic per item; the toggle turns them off globally.
- API: `GET /api/board`, `POST/PATCH/DELETE /api/items`, `GET /api/items/:id/image`, `POST/DELETE /api/links`, `DELETE /api/boards/:slot/clear`, `PATCH /api/settings`.

## Limits

- **Database size** is bounded by disk and server RAM, not the browser — databases of many hundreds of MB are fine. The only upload constraint is Express's 50 MB JSON body limit per request, so a single image larger than ~50 MB cannot be added as-is.
- **Concurrency:** one server process owns the file. Multiple browser tabs work against the same DB, but there is no real-time sync — a tab needs a refresh to see another tab's changes.
- **Backups:** copy `data/board.db` together with its `-wal`/`-shm` siblings while the server is running, or stop the server first for a single self-contained file.
- **History** is session-only and capped at 30 steps.
- There is no authentication; bind to localhost or put the server behind access control if exposing it.
