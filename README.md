# shelf-sorter

A small local KTRU utility for moving disorganized CDs through two stages:

**Unsorted shelf → destination column stacks → destination shelf piles.**

Node.js, Express, better-sqlite3, and plain HTML/CSS/JavaScript. No frontend build step. The interface uses KTRU goldenrod and black with Courier New. Both sorting stages show up to 10 albums per group. Next 10 saves the whole group in one transaction; Undo reverses the last group. The layout follows the existing shelf-lookup utility.

## The invariant

**At all times, each virtual stack must match the physical stack's exact top-to-bottom order.**

- Scan a source stack **top to bottom**. Keep that order while setting CDs aside: append each scanned CD beneath the preceding CDs, or carefully restore the original order before sorting. Do not reverse the stack.
- During source sorting, take the source's **top CD** and place it **on top** of the indicated destination column.
- Existing column `A B C` (top to bottom), followed by placements `X`, `Y`, `Z`, becomes **`Z Y X A B C`**.
- During column sorting, take the column's **top CD** and put it **on top** of its indicated shelf pile. No rescanning is needed. Keep these piles accessible while the session is active so Undo can retrieve the last group.
- Move all CDs shown, in order, then press **Next 10**. For the last group, press **Finish stack**. Undo lists the previous group in reverse order: take each listed CD from the top of its destination pile and put it on top of the original stack, then confirm.

Software cannot detect physical moves. If power/network fails between moving a CD and saving, compare the saved group (including barcodes and metadata) with the physical stack. A partially placed group may contain up to 10 unsaved moves. Return those CDs in reverse placement order before resuming the group. Never blindly repeat Next 10 after an uncertain response. Finish and save the current group before pausing; if you cannot, restore its original physical order first.

## Install and run

Use Node.js 24 LTS (Node 22+ supported) and npm. A native compiler may be needed if better-sqlite3 has no prebuilt binary for your platform.

```sh
npm ci
npm run import -- /absolute/path/to/masterAlbums.db
npm test
npm start
```

Open http://127.0.0.1:3000. The server binds only to the local computer. Set `PORT` to change the port, or `SHELF_DB` to use another application database. The import script accepts an optional second output path:

```sh
npm run import -- /absolute/path/to/masterAlbums.db /absolute/path/to/new-shelfSorter.db
```

Import before starting the app. Import refuses to overwrite any existing output, including an empty database created by starting the server before import. Choose a fresh output path and set `SHELF_DB` if that happens. Do not replace an application database containing sorting progress.

## Windows desktop setup

1. Install **Node.js 24 LTS** using the Windows installer from https://nodejs.org/en/download. Keep npm and Add to PATH selected. Open a fresh setup window after installation.
2. Download the project ZIP (or clone the GitHub repository) and extract it into a permanent local folder. Do not run it from inside the ZIP. Keep the database on the local computer rather than a network share.
3. For a fresh start, copy `masterAlbums.db` into the project folder, alongside `package.json`. It is only an import source and is excluded from Git.
4. Double-click **Setup Windows.cmd**. Internet is needed for the initial dependency installation. It runs `npm ci`, imports the catalog if there is no existing application database, and creates a **Shelf Sorter** shortcut on the current user's desktop.
5. Double-click **Shelf Sorter**. The launcher starts the local server and opens the default browser. Keep the server window open or minimized while sorting. Ctrl+C stops it. Progress survives stopping and restarting.

No hosting service or always-on internet connection is needed after setup. This runs on the Windows computer itself at http://127.0.0.1:3000; it is not shared with other computers. GitHub stores the source code, not the working database.

Clicking the shortcut again opens the running app if it uses this same database. If another app or another copy of Shelf Sorter occupies the port, the launcher reports the conflict. If shortcut creation is blocked by computer policy, double-click `Start Shelf Sorter.cmd` directly; it provides the same launch behavior. No PowerShell execution-policy changes are needed by these scripts.

Keep the project folder in place. If you move it, run Setup Windows.cmd again to update the shortcut. Setup will not reimport or overwrite an existing `data/shelfSorter.db`.

### Bringing existing sorting progress to Windows

Stop the old server cleanly, then copy its **data/shelfSorter.db** into the Windows project's `data` folder before running setup. This carries over the catalog, stacks, and progress. Do not copy `node_modules` from the Mac; setup installs the Windows dependencies. A fresh import from `masterAlbums.db` starts with an empty workflow and does not carry existing sorting progress.

The Windows launcher and shortcut scripts have been syntax-checked here; native Windows launching has not been tested on this Mac. The application tests, including the launcher health endpoint, pass. If setup encounters a native dependency build error, use Node 24 LTS and check the error output; platforms without a prebuilt better-sqlite3 binary require build tools.

## Source database inspection and import

The supplied database was inspected read-only before the application schema was designed. The complete original schema is recorded in `docs/master-schema.sql`:

- `rainbow_albums`: 19,118 albums, 19,118 distinct IDs.
- `barcode`: 14,567 assigned values; **4,551 albums lack assigned barcodes**.
- `new_shelf_label`: destination shelf, populated for every album, covering 416 distinct shelves within columns 1–32.
- `shelf_label`: old shelf location; **not** used as destination.
- `new_shelf`: empty in the inspected data; **not** used as destination.
- Other tables include assignment/artist-sort history, cover fingerprints, external barcode/cache tables and older shared/workflow stacks. They are intentionally not imported. The external barcode table contains no entries.

The importer maps `id`, `barcode`, `artist`, `title`, and `new_shelf_label` into the new `albums` table and derives the numeric column. It trims barcodes while preserving leading zeros, validates identifiers and destinations, and rejects duplicate normalized barcodes. Missing barcodes become NULL: these catalog entries remain present but cannot be scanned until a valid assigned barcode is supplied in a future catalog setup. Unknown barcodes are saved as source-stack items with no album link; they never create guessed catalog records.

The original is opened with SQLite's read-only option. It is never migrated or edited. Existing legacy workflow state is not resumed: begin with physical source stacks whose order can be freshly scanned. `data/shelfSorter.db` is reproducibly generated and ignored by Git.

## Volunteer workflow

1. Enter a source shelf such as `14C`. Scan with a keyboard-style barcode scanner followed by Enter. Unknown barcodes are accepted in their scanned positions; leave those CDs in the stack for now. During source sorting their destination is **Set aside**. Place them on top of a separate set-aside pile, in the displayed sequence. Input refocuses after each scan. Accidental duplicate barcodes within the same source are still rejected.
2. Choose **Finish Scanning**. The home page lists the saved source as ready.
3. Choose **Sort** on a source stack. Move the displayed group top-to-bottom, putting each CD on its indicated column's top. Then press **Next 10** (or Enter/Space). The final, possibly smaller group uses **Finish stack**. Consecutive CDs going to the same column share a highlight; their order stays unchanged. Shelf sorting highlights consecutive matching shelf labels in the same way.
4. After completing a source, scan/sort another source or select a populated column. Column stacks accumulate across sources and application restarts.
5. Choose a column. Move the displayed group top-to-bottom into the indicated shelf piles, then press **Next 10**. **Finish stack** saves the final group, empties that column, marks its albums finished, and returns to the stack list.

There is **one active sorting session at a time**. Finish or resume it before starting another source/column sort. This intentionally prevents interleaved physical moves from invalidating Undo. Scanning other source stacks remains available. Labels of unfinished sources cannot be reused. There is no permanent scanned or finished flag on an album. Once a CD leaves the completed workflow, it can be scanned and sorted again. Only current physical membership is protected: a CD still in an unfinished source, a column stack, or an undoable final-sorting group cannot simultaneously enter another source. Past stack history does not prevent rescanning.

## Recovery and Undo

Scanning, every confirmed group, progress, and Undo live in SQLite, not browser memory. Return home to find unfinished sources and the active sorting session. Browser storage remembers only which screen to display; a new browser can still resume from the database.

**Undo last group** reverses the previous confirmation's progress and all column pushes/pops in one transaction. Its dialog lists the physical moves in reverse order. Return any unsaved moves before undoing a saved group. Group boundaries persist across refresh and restart, including a group smaller than 10. Unknown CDs are included in the reverse-order Undo list: retrieve them from the top of the set-aside pile when instructed. Older sessions created before this feature retain one-CD Undo for their old confirmations.

**Completion is final.** Once the last group is saved, there is no review screen or Undo, and the server rejects further moves or Undo on that session. Completed sources disappear from the active list; a completed column is empty. Completed rows remain in SQLite as history only. No extra confirmation is needed after Finish stack.

Every mutation uses an IMMEDIATE SQLite transaction and checks a global revision. Concurrent/stale tabs and repeated requests using the same revision are rejected before changing anything. The UI disables actions during requests. On an error, current saved state is reloaded; on connection failure, instructions are hidden until recovery. Use one workstation and one operator for physical sorting.

For backups, stop the server cleanly, then copy the application database. Keep backups outside Git. Do not restore an older backup unless physical stacks are also reconciled to that point. Never copy only the main database file while a running instance may have uncheckpointed WAL data.

## Updating an existing shelf-sorter database

Restart the server after updating the code. The application automatically upgrades existing source/session item tables in one SQLite transaction, preserving positions, active cursors, column contents and Undo boundaries. The obsolete `finished_albums` table and global source-album uniqueness restriction are removed. The original `masterAlbums.db` is not involved in this upgrade. No reimport is needed.

## Database structure

- `albums`: minimal catalog, unique nullable barcode, validated destination and numeric column.
- `source_stacks`: physical source label and scanning/ready/sorting/done status.
- `source_items`: each stack's scanned barcode sequence, with an optional album link; ascending position is source top-to-bottom. Barcodes are unique within that source only. Unknowns occupy normal positions.
- `column_items`: current column contents; **descending autoincrement position** is top-to-bottom. Position is a stable stack-order key, not a dense array index.
- `sessions`: source/column identity, durable cursor, initial total and completion status. A partial unique index permits only one active session.
- `session_items`: immutable album sequence for that session plus each column position needed for exact Undo. A source session's cursor separates processed items from the remaining physical source; column sessions pop current membership on each confirmation.
- `session_actions`: saved group boundaries (start position and count) for durable group Undo. Added automatically to existing application databases without changing their stack contents.
- `state`: monotonically increasing revision for optimistic concurrency.

Foreign keys, uniqueness constraints, FULL synchronous writes and transactions protect the state. Source scan history remains after sorting; it is history, not a second current physical stack. Column start snapshots its current top-to-bottom order. All mutation logic is in `db/stacks.js`; API routes are in `server.js` and the interface is in `public/`.

## Tests

```sh
npm test
```

Tests use isolated temporary or in-memory databases, never the real catalog/workflow database. They cover scan order, source reversal, multiple-source accumulation, the explicit `Z Y X A B C` example, mixed columns, exact group Undo, final completion lockout, restart/resume in every phase, final top-to-bottom consumption, empty/duplicate/unknown/stale actions, session exclusion, rollback after a forced database failure, importer immutability/validation, an in-process Express request workflow (including middleware, routes and static HTML), rescanning after completion, unknown/set-aside items across restart and Undo, legacy schema migration, and client tests for group controls, completion navigation, destination-run highlighting and stale saved screens.

## GitHub

Working databases, the original database, dependencies and SQLite journals/WAL files are ignored. Commit the source and lockfile, not working state.

If GitHub authentication is unavailable, run from this repository:

```sh
gh auth login -h github.com
gh repo create shelf-sorter --private --source=. --remote=origin --push
```

The create command creates a private repository and pushes the existing local `main` commit. Use `--public` instead if you intend to publish the source publicly.

## Verification on the build machine

All seventeen automated test groups passed on Node 24.19.0. The real import produced 19,118 albums / 14,567 scannable barcodes; SQLite integrity and foreign-key checks passed. A SHA-256 comparison confirmed the original database remained unchanged.

Dependencies were installed from locally cached npm archives because outbound registry access was unavailable. This environment also rejected binding a local listening socket (`EPERM`), so live browser/server startup could not be verified here. The Express request tests run without a listening socket. The local-file browser preview is also blocked by browser URL policy. Client tests exercise the actual rendering and state transitions without a browser, but visual layout has not been verified in a browser here. Run `npm start` outside these restrictions and try a small known physical stack before production sorting.
