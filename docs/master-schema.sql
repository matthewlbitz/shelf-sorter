CREATE TABLE IF NOT EXISTS "rainbow_albums" (
"id" INTEGER,
  "discogs_id" TEXT,
  "title" TEXT,
  "artist" TEXT,
  "genre" TEXT,
  "year" INTEGER,
  "tracklist" TEXT,
  "cover_image" TEXT,
  "discogs_link" TEXT,
  "style" TEXT,
  "label" TEXT,
  "shelf_label" TEXT,
  "primary_genre" TEXT,
  "secondary_genre" TEXT,
  "new_shelf" TEXT,
  "new_shelf_label" TEXT
, "barcode" TEXT, "assigned_at" TEXT, "artist_sort" TEXT);
CREATE TABLE assignment_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    album_id INTEGER NOT NULL,
    barcode TEXT NOT NULL,
    assigned_at TEXT NOT NULL,
    undone_at TEXT
  );
CREATE TABLE sqlite_sequence(name,seq);
CREATE UNIQUE INDEX idx_rainbow_albums_barcode
    ON "rainbow_albums" ("barcode")
    WHERE "barcode" IS NOT NULL
      AND TRIM("barcode") <> ''
  ;
CREATE INDEX idx_rainbow_albums_artist_title
    ON "rainbow_albums" ("artist", "title")
  ;
CREATE TABLE artist_sort_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    artist TEXT NOT NULL,
    artist_sort TEXT NOT NULL,
    previous_values TEXT NOT NULL,
    sorted_at TEXT NOT NULL,
    undone_at TEXT
  );
CREATE TABLE cover_fingerprints (
  album_id INTEGER PRIMARY KEY, image_url TEXT NOT NULL, fingerprint BLOB,
  error TEXT, updated_at TEXT NOT NULL
);
CREATE TABLE album_external_barcodes (
    album_id INTEGER NOT NULL, code TEXT NOT NULL, source TEXT NOT NULL DEFAULT 'import',
    PRIMARY KEY (album_id, code));
CREATE INDEX idx_external_code ON album_external_barcodes(code);
CREATE TABLE discogs_barcode_cache (
    code TEXT PRIMARY KEY, payload TEXT NOT NULL, expires_at INTEGER NOT NULL);
CREATE TABLE shared_sort_stacks (
    id TEXT PRIMARY KEY, column_label TEXT NOT NULL, scans TEXT NOT NULL,
    owner TEXT, position INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
CREATE TABLE shared_column_stacks (
    id TEXT PRIMARY KEY, column_label TEXT NOT NULL, scans TEXT NOT NULL,
    owner TEXT, position INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
CREATE TABLE workflow_stacks (
    id TEXT PRIMARY KEY, parent TEXT, name TEXT NOT NULL, stage TEXT NOT NULL,
    owner TEXT, worker TEXT, revision INTEGER NOT NULL DEFAULT 0, data TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE workflow_operations (id TEXT PRIMARY KEY, stack_id TEXT NOT NULL);
