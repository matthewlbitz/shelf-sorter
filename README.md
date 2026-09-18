# shelf-sorter

A small local KTRU utility for moving disorganized CDs through two stages:

**Unsorted shelf → destination column stacks → destination shelf piles.**

Node.js, Express, better-sqlite3, and plain HTML/CSS/JavaScript. No frontend build step. The interface uses KTRU goldenrod and black with Courier New. Both sorting stages preview up to 10 albums without changing the one-CD transaction and Undo semantics.

## The invariant

**At all times, each virtual stack must match the physical stack's exact top-to-bottom order.**

- Scan a source stack **top to bottom**. Keep that order while setting CDs aside: append each scanned CD beneath the preceding CDs, or carefully restore the original order before sorting. Do not reverse the stack.
- During source sorting, take the source's **top CD** and place it **on top** of the indicated destination column.
- Existing column `A B C` (top to bottom), followed by placements `X`, `Y`, `Z`, becomes **`Z Y X A B C`**.
- During column sorting, take the column's **top CD** and put it **on top** of its indicated shelf pile. No rescanning is needed. Keep these piles accessible until the session is accepted, so Undo can retrieve the last CD.
- Press **Moved CD — Next** only after moving that CD. Undo requires returning that same physical CD to the top of the original stack, then confirming the database reversal.

Software cannot detect physical moves. If power/network fails between moving a CD and saving, compare the saved next instruction (including barcode and metadata) with the physical top. Reconcile that single move before continuing. Never blindly repeat Next after an uncertain response.

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

## Source database inspection and import

The supplied database was inspected read-only before the application schema was designed. The complete original schema is recorded in `docs/master-schema.sql`:

- `rainbow_albums`: 19,118 albums, 19,118 distinct IDs.
- `barcode`: 14,567 assigned values; **4,551 albums lack assigned barcodes**.
- `new_shelf_label`: destination shelf, populated for every album, covering 416 distinct shelves within columns 1–32.
- `shelf_label`: old shelf location; **not** used as destination.
- `new_shelf`: empty in the inspected data; **not** used as destination.
- Other tables include assignment/artist-sort history, cover fingerprints, external barcode/cache tables and older shared/workflow stacks. They are intentionally not imported. The external barcode table contains no entries.

The importer maps `id`, `barcode`, `artist`, `title`, and `new_shelf_label` into the new `albums` table and derives the numeric column. It trims barcodes while preserving leading zeros, validates identifiers and destinations, and rejects duplicate normalized barcodes. Missing barcodes become NULL: these catalog entries remain present but cannot be scanned until a valid assigned barcode is supplied in a future catalog setup. Unknown scans stop with an error; they never create guessed records.

The original is opened with SQLite's read-only option. It is never migrated or edited. Existing legacy workflow state is not resumed: begin with physical source stacks whose order can be freshly scanned. `data/shelfSorter.db` is reproducibly generated and ignored by Git.

## Volunteer workflow

1. Enter a source shelf such as `14C`. Scan with a keyboard-style barcode scanner followed by Enter. Wait for success before scanning the next CD. Unknown and duplicate scans leave the stack unchanged. Input refocuses after each scan.
2. Choose **Finish Scanning**. The home page lists the saved source as ready.
3. Choose **Sort into columns**. Read the next 10 albums in top-to-bottom order. The goldenrod highlighted row is the next CD: physically move it to the indicated column's top, then confirm. The list advances by one album. Space or Enter also confirms when focus is outside other controls.
4. After completing a source, scan/sort another source or select a populated column. Column stacks accumulate across sources and application restarts.
5. Choose **Sort into shelves**. Follow the next-10 list in stored column order from top to bottom, moving and confirming each CD individually into the indicated shelf pile. Completion empties that column and marks its albums finished.

There is **one active sorting session at a time**. Finish or resume it before starting another source/column sort. This intentionally prevents interleaved physical moves from invalidating Undo. Scanning other source stacks remains available. Labels of unfinished sources cannot be reused. Albums cannot be scanned again in another source, including after completion; this prevents a second virtual copy of one physical CD.

## Recovery and Undo

Scanning, every confirmed move, progress, and Undo live in SQLite, not browser memory. Return home to find unfinished sources and the active sorting session. Browser storage remembers only which screen to display; a new browser can still resume from the database.

**Undo Last** reverses progress and the corresponding column push/pop in one transaction. The dialog specifies the physical reverse move. Repeated Undo can step backward through the latest session. Completion does not immediately discard Undo: it remains available until another sorting session starts. Starting a new session closes that prior undo window. No arbitrary cancellation, reordering, or deletion is offered because those would require a separate physical reconciliation workflow.

Every mutation uses an IMMEDIATE SQLite transaction and checks a global revision. Concurrent/stale tabs and repeated requests using the same revision are rejected before changing anything. The UI disables actions during requests. On an error, current saved state is reloaded; on connection failure, instructions are hidden until recovery. Use one workstation and one operator for physical sorting.

For backups, stop the server cleanly, then copy the application database. Keep backups outside Git. Do not restore an older backup unless physical stacks are also reconciled to that point. Never copy only the main database file while a running instance may have uncheckpointed WAL data.

## Database structure

- `albums`: minimal catalog, unique nullable barcode, validated destination and numeric column.
- `source_stacks`: physical source label and scanning/ready/sorting/done status.
- `source_items`: permanent scan ledger; ascending position is source top-to-bottom. Album uniqueness prevents duplicate physical membership.
- `column_items`: current column contents; **descending autoincrement position** is top-to-bottom. Position is a stable stack-order key, not a dense array index.
- `sessions`: source/column identity, durable cursor, initial total and completion status. A partial unique index permits only one active session.
- `session_items`: immutable album sequence for that session plus each column position needed for exact Undo. A source session's cursor separates processed items from the remaining physical source; column sessions pop current membership on each confirmation.
- `finished_albums`: albums confirmed into final shelf piles.
- `state`: monotonically increasing revision for optimistic concurrency.

Foreign keys, uniqueness constraints, FULL synchronous writes and transactions protect the state. Source scan history remains after sorting; it is history, not a second current physical stack. Column start snapshots its current top-to-bottom order. All mutation logic is in `db/stacks.js`; API routes are in `server.js` and the interface is in `public/`.

## Tests

```sh
npm test
```

Tests use isolated temporary or in-memory databases, never the real catalog/workflow database. They cover scan order, source reversal, multiple-source accumulation, the explicit `Z Y X A B C` example, mixed columns, exact Undo including final completion, restart/resume in every phase, final top-to-bottom consumption, empty/duplicate/unknown/stale actions, session exclusion, rollback after a forced database failure, importer immutability/validation and an in-process Express request workflow (including middleware, routes and static HTML).

## GitHub

Working databases, the original database, dependencies and SQLite journals/WAL files are ignored. Commit the source and lockfile, not working state.

If GitHub authentication is unavailable, run from this repository:

```sh
gh auth login -h github.com
gh repo create shelf-sorter --private --source=. --remote=origin --push
```

The create command creates a private repository and pushes the existing local `main` commit. Use `--public` instead if you intend to publish the source publicly.

## Verification on the build machine

All eight automated test groups passed on Node 24.19.0. The real import produced 19,118 albums / 14,567 scannable barcodes; SQLite integrity and foreign-key checks passed. A SHA-256 comparison confirmed the original database remained unchanged.

Dependencies were installed from locally cached npm archives because outbound registry access was unavailable. This environment also rejected binding a local listening socket (`EPERM`), so live browser/server startup could not be verified here. The Express request tests run without a listening socket. Run `npm start` outside that restriction and try a small known physical stack before production sorting.
