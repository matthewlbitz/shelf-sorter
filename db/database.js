const Database = require('better-sqlite3');
const path = require('node:path');
const fs = require('node:fs');
const defaultPath = path.join(__dirname, '../data/shelfSorter.db');
function openDatabase(filename = defaultPath) {
  if (filename !== ':memory:') fs.mkdirSync(path.dirname(path.resolve(filename)), { recursive: true });
  const db = new Database(filename);
  db.pragma('foreign_keys = ON');
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = FULL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS state (id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL);
    INSERT OR IGNORE INTO state VALUES(1,0);
    CREATE TABLE IF NOT EXISTS albums (
      id INTEGER PRIMARY KEY, barcode TEXT UNIQUE, artist TEXT NOT NULL, title TEXT NOT NULL,
      destination_shelf TEXT NOT NULL,
      destination_column INTEGER NOT NULL CHECK(destination_column BETWEEN 1 AND 32)
    );
    CREATE TABLE IF NOT EXISTS source_stacks (
      id INTEGER PRIMARY KEY, label TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'scanning' CHECK(status IN ('scanning','ready','sorting','done'))
    );
    CREATE UNIQUE INDEX IF NOT EXISTS active_source_label ON source_stacks(label) WHERE status!='done';
    CREATE TABLE IF NOT EXISTS source_items (
      source_id INTEGER NOT NULL REFERENCES source_stacks(id),
      position INTEGER NOT NULL CHECK(position>=0), album_id INTEGER REFERENCES albums(id),
      barcode TEXT NOT NULL CHECK(length(barcode)>0),
      PRIMARY KEY(source_id,position), UNIQUE(source_id,barcode)
    );
    CREATE TABLE IF NOT EXISTS column_items (
      position INTEGER PRIMARY KEY AUTOINCREMENT,
      column_id INTEGER NOT NULL CHECK(column_id BETWEEN 1 AND 32),
      album_id INTEGER NOT NULL UNIQUE REFERENCES albums(id)
    );
    CREATE INDEX IF NOT EXISTS column_order ON column_items(column_id,position DESC);
    CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY, kind TEXT NOT NULL CHECK(kind IN ('source','column')),
      source_id INTEGER REFERENCES source_stacks(id), column_id INTEGER,
      cursor INTEGER NOT NULL DEFAULT 0 CHECK(cursor>=0), total INTEGER NOT NULL CHECK(total>0),
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','done')),
      CHECK((kind='source' AND source_id IS NOT NULL AND column_id IS NULL) OR
            (kind='column' AND source_id IS NULL AND column_id BETWEEN 1 AND 32))
    );
    CREATE UNIQUE INDEX IF NOT EXISTS one_active_session ON sessions(status) WHERE status='active';
    CREATE TABLE IF NOT EXISTS session_items (
      session_id INTEGER NOT NULL REFERENCES sessions(id), position INTEGER NOT NULL,
      album_id INTEGER REFERENCES albums(id), column_position INTEGER,
      barcode TEXT NOT NULL CHECK(length(barcode)>0),
      PRIMARY KEY(session_id,position), UNIQUE(session_id,barcode)
    );
    CREATE TABLE IF NOT EXISTS session_actions (
      session_id INTEGER NOT NULL REFERENCES sessions(id),
      start_cursor INTEGER NOT NULL CHECK(start_cursor>=0),
      count INTEGER NOT NULL CHECK(count BETWEEN 1 AND 10),
      PRIMARY KEY(session_id,start_cursor)
    );
  `);
  try { migrateScanItems(db); }
  catch (error) { db.close(); throw error; }
  return db;
}
// Upgrade existing workflow databases without changing any stored positions or cursors.
function migrateScanItems(db) {
  const oldSources = !db.pragma('table_info(source_items)').some(field => field.name==='barcode');
  const oldSessions = !db.pragma('table_info(session_items)').some(field => field.name==='barcode');
  const oldFinished = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='finished_albums'").get();
  if (!oldSources && !oldSessions && !oldFinished) return;
  db.transaction(() => {
    if (oldSources) db.exec(`
      CREATE TABLE source_items_new (
        source_id INTEGER NOT NULL REFERENCES source_stacks(id),
        position INTEGER NOT NULL CHECK(position>=0), album_id INTEGER REFERENCES albums(id),
        barcode TEXT NOT NULL CHECK(length(barcode)>0),
        PRIMARY KEY(source_id,position), UNIQUE(source_id,barcode)
      );
      INSERT INTO source_items_new SELECT i.source_id,i.position,i.album_id,a.barcode
        FROM source_items i JOIN albums a ON a.id=i.album_id;
      DROP TABLE source_items;
      ALTER TABLE source_items_new RENAME TO source_items;
    `);
    if (oldSessions) db.exec(`
      CREATE TABLE session_items_new (
        session_id INTEGER NOT NULL REFERENCES sessions(id), position INTEGER NOT NULL,
        album_id INTEGER REFERENCES albums(id), column_position INTEGER,
        barcode TEXT NOT NULL CHECK(length(barcode)>0),
        PRIMARY KEY(session_id,position), UNIQUE(session_id,barcode)
      );
      INSERT INTO session_items_new SELECT i.session_id,i.position,i.album_id,i.column_position,a.barcode
        FROM session_items i JOIN albums a ON a.id=i.album_id;
      DROP TABLE session_items;
      ALTER TABLE session_items_new RENAME TO session_items;
    `);
    db.exec('DROP TABLE IF EXISTS finished_albums');
    db.prepare('UPDATE state SET revision=revision+1 WHERE id=1').run();
  }).immediate();
}
module.exports = { openDatabase, defaultPath };
