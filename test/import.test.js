const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const crypto=require('node:crypto');
const Database=require('better-sqlite3');
const {importAlbums}=require('../db/importMasterAlbums');
const {openDatabase}=require('../db/database');
test('import preserves source bytes, leading zeros and missing barcodes; refuses overwrite',t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'shelf-import-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const source=path.join(dir,'master.db'),dest=path.join(dir,'app.db');
  const db=new Database(source);
  db.exec("CREATE TABLE rainbow_albums(id INTEGER,barcode TEXT,artist TEXT,title TEXT,new_shelf_label TEXT); INSERT INTO rainbow_albums VALUES(1,'00123','Artist','Album','17D'),(2,NULL,NULL,'Other','4B');");db.close();
  const hash=()=>crypto.createHash('sha256').update(fs.readFileSync(source)).digest('hex');const before=hash();
  assert.deepEqual(importAlbums(source,dest),{albums:2,scannable:1,missingBarcodes:1});
  assert.equal(hash(),before);const out=openDatabase(dest);
  assert.equal(out.prepare('SELECT barcode FROM albums WHERE id=1').get().barcode,'00123');out.close();
  assert.throws(()=>importAlbums(source,dest),/already exists/);
  assert.throws(()=>importAlbums(source,source),/already exists/);
});
test('malformed source data fails before creating output',t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'shelf-invalid-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const source=path.join(dir,'source.db'),dest=path.join(dir,'dest.db');const db=new Database(source);
  db.exec("CREATE TABLE rainbow_albums(id INTEGER,barcode TEXT,artist TEXT,title TEXT,new_shelf_label TEXT); INSERT INTO rainbow_albums VALUES(1,'A','Artist','Album','99Z');");db.close();
  assert.throws(()=>importAlbums(source,dest),/Invalid destination/);assert.equal(fs.existsSync(dest),false);
});
