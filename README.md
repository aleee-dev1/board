# The Board

A movie-style detective board: a brown cork surface with draggable, rotatable notes and Polaroid-style evidence photos, connected by red string. Everything is saved to a single SQLite database, with images stored inside it as BLOBs.

## Run

```bash
npm install
npm start
```

Then open <http://localhost:3000>. Run the server in the foreground in your own terminal; stop it with Ctrl+C.

Everything is saved automatically to `data/board.db` (a SQLite file with `-wal`/`-shm` siblings). Camera position, zoom and the Retro toggle are saved too. Set `DB_PATH=/path/to/other.db` to use a different database file.

## Boards

Boards are anonymous slots, like desktop workspaces. The toolbar's last group shows `< 2 >` plus a clear button:

- Left arrow goes back, disabled on board 1.
- Right arrow goes forward. When you're on the last board **and it has items**, it creates and opens the next empty board. It is disabled if that last board is empty, so you can't skip past a blank board.
- The clear button asks "Delete everything on current board?" and empties only the current slot. The slot and its camera/Retro settings stay.

Each slot stores its own items, links, camera and Retro setting, all in the same SQLite file. Older single-board databases are migrated into slot 1 automatically.

## Controls

| Action | How |
| --- | --- |
| Select / move | **Select** tool (V), then left-drag an item |
| Multi-select | With the **Select** tool, drag an empty area of the board to rubber-band several items. They can only be deleted together; clicking empty space or Esc clears the selection |
| Rotate | Drag the round handle above a selected item (hold Shift to snap to 15°) |
| Add note | **Note** tool (N), then click the board and type. Double-click a note to edit it again |
| Grow / widen note | Notes grow downward automatically as you type; drag the grip on the right edge of a selected note to change its width (text reflows live) |
| Add image / text | **Image** tool (I) opens the file picker (multi-select allowed), or drop files onto the board. Images become photos; `.txt` files become notes with their contents pre-filled. Several files are staggered so they don't overlap |
| Connect / remove string | **String** tool (S), click two items. Clicking the same pair again removes the string |
| Tape an item down | **Tape** tool (T), click a note or photo. A clear strip appears in its upper-left corner and it can no longer be moved, rotated or resized. Click it again with the Tape tool to remove it |
| Pan | Right-drag anywhere |
| Zoom | Mouse wheel (zooms toward the cursor), or `+` / `-` keys |
| Reset view | `0` key |
| Cycle tools | Ctrl+← / Ctrl+→ (focuses the tool button without triggering the image picker) |
| Add a caption | Double-click a photo and type in the white strip below it; click away to finish. Captions are single-line and capped by the strip's width, so wide photos hold more text than narrow ones |
| Delete | Select an item, then press Delete/Backspace or click **Delete** — a confirmation bar appears above the toolbar with Yes/No (Esc cancels) |
| Retro filter | Toolbar **Retro** toggle (global) |

The camera position and zoom are saved with the board and restored on reload.

## Stack

- Express server (`server.js`), vanilla frontend in `public/`
- `sqlite3` for storage (`db.js`) — single board, items and links in SQLite
- Images are stored in the DB **exactly as uploaded** (no downscaling); original filenames are kept so downloads use them. They're served from `/api/items/:id/image`
- Selecting an item reveals Download and Delete buttons floating on the item itself; notes download as `.txt`, images as their original file. With a multi-selection, only Delete appears on each item
- Red strings are an SVG layer inside the transformed world, so they follow the items automatically
- Retro look = fine paper grain plus generated wear cracks: white chips/cracks on photos, blue cracks on the yellow notes. The pattern is deterministic per item so it survives reloads. The global Retro toggle turns it all off
- Notes auto-grow vertically; the right-edge grip resizes width and reflows text live
- Tape is a persisted `taped` flag on items; photo captions are stored in a `caption` column. Both are added to older databases automatically
- The grab cursor only appears over notes and photos, so the pointer stays precise for rotation handles elsewhere

## API

- `GET /api/board` — items, links and settings
- `POST /api/items`, `PATCH /api/items/:id`, `DELETE /api/items/:id`
- `GET /api/items/:id/image`
- `POST /api/links`, `DELETE /api/links/:id`
- `PATCH /api/settings`
