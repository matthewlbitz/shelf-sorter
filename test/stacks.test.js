const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { openDatabase } = require('../db/database');
const { createStore } = require('../db/stacks');
function setup(t,filename=':memory:') {
  const db = openDatabase(filename); t.after(()=>db.close());
  for (const [i,code] of [...'ABCXYZQ'].entries()) db.prepare('INSERT INTO albums VALUES(?,?,?,?,?,?)').run(i+1,code,'Artist',code,code==='Q'?'4B':i%2?'17A':'17D',code==='Q'?4:17);
  const store=createStore(db);
  const act=(type,data={})=>store.action(store.snapshot().revision,type,data);
  const scan=(codes,label='14C')=>{
    act('createSource',{label}); const id=store.snapshot().sources[0].id;
    for(const barcode of codes) act('scan',{id,barcode});
    act('finishScan',{id}); return id;
  };
  const drain=()=>{while(store.snapshot().session.status==='active') act('next',{id:store.snapshot().session.id});};
  const order=()=>db.prepare('SELECT a.barcode FROM column_items c JOIN albums a ON a.id=c.album_id WHERE column_id=17 ORDER BY position DESC').all().map(x=>x.barcode).join('');
  return {db,store,act,scan,drain,order};
}
test('scan order, source reversal, persistent second source, exact undo',t=>{
  const {db,store,act,scan,drain,order}=setup(t);
  const first=scan('CBA');
  assert.deepEqual(db.prepare('SELECT album_id FROM source_items ORDER BY position').all().map(x=>x.album_id),[3,2,1]);
  act('startSource',{id:first}); drain(); assert.equal(order(),'ABC');
  const second=scan('XYZ','15A'); act('startSource',{id:second}); drain();
  assert.equal(order(),'ZYXABC'); // Explicit physical convention: X, Y, Z each placed ON TOP.
  const sid=store.snapshot().session.id;
  act('undo',{id:sid}); assert.equal(order(),'YXABC'); assert.equal(store.snapshot().session.next.barcode,'Z');
  act('next',{id:sid}); assert.equal(order(),'ZYXABC');
  act('startColumn',{id:17}); const final=store.snapshot().session.id;
  const seen=[];
  while(store.snapshot().session.status==='active') { seen.push(store.snapshot().session.next.barcode); act('next',{id:final}); }
  assert.equal(seen.join(''),'ZYXABC'); assert.equal(order(),'');
  assert.equal(db.prepare('SELECT count(*) n FROM finished_albums').get().n,6);
  act('undo',{id:final}); assert.equal(order(),'C');
  act('next',{id:final}); assert.equal(order(),'');
  assert.throws(()=>act('startSource',{id:first}),/finished, unsorted/);
  assert.throws(()=>act('startColumn',{id:17}),/empty/);
  assert.throws(()=>act('undo',{id:sid}),/most recent/);
});
test('duplicate, unknown, empty, invalid and stale requests leave state unchanged',t=>{
  const {store,act}=setup(t);
  assert.throws(()=>act('createSource',{label:'33A'}),/shelf label/);
  act('createSource',{label:'1A'}); const id=store.snapshot().sources[0].id;
  assert.throws(()=>act('finishScan',{id}),/at least/);
  act('scan',{id,barcode:'A'}); const before=store.snapshot();
  assert.throws(()=>act('scan',{id,barcode:'A'}),/DUPLICATE/);
  assert.throws(()=>act('scan',{id,barcode:'unknown'}),/UNKNOWN/);
  assert.throws(()=>store.action(before.revision-1,'scan',{id,barcode:'B'}),/State changed/);
  assert.deepEqual(store.snapshot(),before);
});
test('close and reopen resumes scanning, source sorting and final sorting',t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'shelf-test-')); t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const file=path.join(dir,'test.db');
  let db=openDatabase(file);
  for(const [i,c] of [...'ABC'].entries()) db.prepare('INSERT INTO albums VALUES(?,?,?,?,?,?)').run(i+1,c,'Artist',c,'17D',17);
  let store=createStore(db);
  const act=(type,data)=>store.action(store.snapshot().revision,type,data);
  const reopen=()=>{db.close(); db=openDatabase(file); store=createStore(db);};
  act('createSource',{label:'14C'}); act('scan',{id:1,barcode:'A'}); reopen();
  assert.equal(store.snapshot().sources[0].count,1);
  act('scan',{id:1,barcode:'B'}); act('scan',{id:1,barcode:'C'}); act('finishScan',{id:1});
  act('startSource',{id:1}); act('next',{id:1}); reopen();
  assert.equal(store.snapshot().session.next.barcode,'B');
  act('undo',{id:1}); assert.equal(store.snapshot().session.next.barcode,'A');
  for(let i=0;i<3;i++) act('next',{id:1});
  act('startColumn',{id:17}); act('next',{id:2}); reopen();
  assert.equal(store.snapshot().session.next.barcode,'B');
  act('undo',{id:2}); assert.equal(store.snapshot().session.next.barcode,'C'); db.close();
});
test('one sorting session at a time; mixed destinations; transactional rollback on failure',t=>{
  const {db,store,act,scan,order}=setup(t);
  const id=scan('AQB'); act('startSource',{id}); act('next',{id:1});
  assert.throws(()=>act('startColumn',{id:17}),/Resume/);
  act('next',{id:1}); assert.equal(order(),'A');
  act('undo',{id:1}); assert.equal(db.prepare('SELECT count(*) n FROM column_items WHERE column_id=4').get().n,0);
  // Force a database write failure after the column INSERT; the whole move must roll back.
  db.exec("CREATE TRIGGER fail_progress BEFORE UPDATE ON sessions BEGIN SELECT RAISE(ABORT,'test failure'); END;");
  const before=store.snapshot();
  assert.throws(()=>act('next',{id:1}),/test failure/);
  assert.deepEqual(store.snapshot(),before);
  assert.equal(db.prepare('SELECT count(*) n FROM column_items WHERE column_id=4').get().n,0);
});

test('ten-album preview follows physical order through moves, undo and resume in both stages',t=>{
  const db=openDatabase(':memory:');t.after(()=>db.close());
  const store=createStore(db);
  const act=(type,data)=>store.action(store.snapshot().revision,type,data);
  const codes=Array.from({length:12},(_,i)=>`CD${i+1}`);
  codes.forEach((code,i)=>db.prepare('INSERT INTO albums VALUES(?,?,?,?,?,?)').run(i+1,code,'Artist',code,i%2?'17A':'17D',17));
  act('createSource',{label:'14C'});
  codes.forEach(barcode=>act('scan',{id:1,barcode}));
  act('finishScan',{id:1});act('startSource',{id:1});
  const preview=()=>store.snapshot().session.upcoming.map(a=>a.barcode);
  assert.deepEqual(preview(),codes.slice(0,10));
  act('next',{id:1});assert.deepEqual(preview(),codes.slice(1,11));
  assert.deepEqual(createStore(db).snapshot().session.upcoming.map(a=>a.barcode),codes.slice(1,11));
  act('undo',{id:1});assert.deepEqual(preview(),codes.slice(0,10));
  for(let i=0;i<12;i++)act('next',{id:1});
  assert.deepEqual(preview(),[]);
  act('startColumn',{id:17});
  const reversed=[...codes].reverse();
  assert.deepEqual(preview(),reversed.slice(0,10));
  act('next',{id:2});assert.deepEqual(preview(),reversed.slice(1,11));
  act('undo',{id:2});assert.deepEqual(preview(),reversed.slice(0,10));
  for(let i=0;i<10;i++)act('next',{id:2});
  assert.deepEqual(preview(),['CD2','CD1']);
  assert.equal(store.snapshot().session.upcoming[0].position,10);
  act('next',{id:2});act('next',{id:2});assert.deepEqual(preview(),[]);
});
