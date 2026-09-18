const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const Database=require('better-sqlite3');
const {openDatabase}=require('../db/database');
const {createStore}=require('../db/stacks');

test('legacy migration preserves orders, scanning and active group Undo and removes permanent album status',t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'shelf-migration-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const filename=path.join(dir,'legacy.db');let db=new Database(filename);
  db.pragma('foreign_keys=ON');db.exec(fs.readFileSync(path.join(__dirname,'fixtures/legacy-schema.sql'),'utf8'));
  for(let i=1;i<=14;i++)db.prepare('INSERT INTO albums VALUES(?,?,?,?,?,?)').run(i,`00${i}`,'Artist','Album','17D',17);
  db.exec(`INSERT INTO source_stacks VALUES(1,'14C','sorting'),(2,'1A','done'),(3,'2A','scanning');
    INSERT INTO sessions VALUES(0,'column',NULL,17,1,1,'done'),(1,'source',1,NULL,2,12,'active');
    INSERT INTO column_items VALUES(77,17,1),(78,17,2);
    INSERT INTO session_actions VALUES(1,0,2);
    INSERT INTO source_items VALUES(2,0,13),(3,0,14);
    INSERT INTO session_items VALUES(0,0,13,70);
    INSERT INTO finished_albums VALUES(13,0);`);
  for(let i=0;i<12;i++) {
    db.prepare('INSERT INTO source_items VALUES(?,?,?)').run(1,i,i+1);
    db.prepare('INSERT INTO session_items VALUES(?,?,?,?)').run(1,i,i+1,i<2?77+i:null);
  }
  const columns=db.prepare('SELECT * FROM column_items ORDER BY position').all();db.close();
  db=openDatabase(filename);const store=createStore(db);
  assert.deepEqual(db.pragma('foreign_key_check'),[]);
  assert.deepEqual(db.prepare('SELECT * FROM column_items ORDER BY position').all(),columns);
  assert.equal(store.snapshot().session.cursor,2);
  assert.deepEqual(store.snapshot().session.undoItems.map(x=>x.barcode),['002','001']);
  assert.equal(store.snapshot().sources.find(x=>x.id===3).count,1);
  assert.equal(store.snapshot().sources.find(x=>x.id===3).last.barcode,'0014');
  assert.equal(db.prepare("SELECT name FROM sqlite_master WHERE name='finished_albums'").get(),undefined);
  const act=(type,data)=>store.action(store.snapshot().revision,type,data);
  act('scan',{id:3,barcode:'unknown'});
  // Historical finished album can be scanned again while unrelated work is active.
  act('scan',{id:3,barcode:'0013'});
  act('undo',{id:1});assert.deepEqual(store.snapshot().columns,[]);
  assert.equal(store.snapshot().session.cursor,0);
  const before=store.snapshot();db.close();db=openDatabase(filename);
  assert.deepEqual(createStore(db).snapshot(),before);db.close();
});
