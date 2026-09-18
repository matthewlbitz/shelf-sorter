const Database = require('better-sqlite3');
const fs = require('node:fs');
const path = require('node:path');
const { openDatabase, defaultPath } = require('./database');
function importAlbums(source, destination = defaultPath) {
  if (!source) throw new Error('Usage: npm run import -- /path/to/masterAlbums.db [new-output.db]');
  if (!fs.existsSync(source)) throw new Error('Import source does not exist.');
  if (fs.existsSync(destination)) throw new Error('Output already exists. Refusing to overwrite a database.');
  if (path.resolve(source) === path.resolve(destination)) throw new Error('Source and output must differ.');
  const original = new Database(source, { readonly: true, fileMustExist: true });
  let db;
  try {
    const fields = original.prepare('PRAGMA table_info(rainbow_albums)').all().map(x => x.name);
    for (const field of ['id','barcode','artist','title','new_shelf_label']) {
      if (!fields.includes(field)) throw new Error(`Expected inspected source field missing: ${field}`);
    }
    const rows = original.prepare('SELECT id,barcode,artist,title,new_shelf_label FROM rainbow_albums').all();
    if (!rows.length) throw new Error('Source contains no albums.');
    const ids = new Set(), codes = new Set();
    for (const row of rows) {
      if (!Number.isSafeInteger(row.id) || ids.has(row.id)) throw new Error('Invalid or duplicate album ID.');
      ids.add(row.id);
      row.barcode = row.barcode == null ? null : String(row.barcode).trim() || null;
      if (row.barcode && codes.has(row.barcode)) throw new Error(`Duplicate normalized barcode: ${row.barcode}`);
      if (row.barcode) codes.add(row.barcode);
      if (!/^(?:[1-9]|[12]\d|3[0-2])[A-Z]+$/.test(row.new_shelf_label || '')) throw new Error(`Invalid destination for album ${row.id}`);
    }
    db = openDatabase(destination);
    const insert = db.prepare('INSERT INTO albums VALUES(?,?,?,?,?,?)');
    db.transaction(() => {
      for (const r of rows) insert.run(r.id,r.barcode,r.artist || '',r.title || '',r.new_shelf_label,parseInt(r.new_shelf_label,10));
    })();
    return { albums: rows.length, scannable: codes.size, missingBarcodes: rows.length-codes.size };
  } finally { original.close(); if (db) db.close(); }
}
if (require.main === module) {
  try { console.log(JSON.stringify(importAlbums(process.argv[2],process.argv[3]),null,2)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { importAlbums };
