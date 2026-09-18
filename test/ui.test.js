const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {openDatabase}=require('../db/database');
const {createStore}=require('../db/stacks');

// Run the actual client against the actual store, without browser/network dependencies.
// This checks screen transitions and the rendered controls, not pixel layout.
async function client(store,view='sort') {
  const app={innerHTML:'',addEventListener(){}},feedback={textContent:'',className:''};
  const saved=new Map([['view',view]]);
  const context=vm.createContext({
    document:{querySelector:selector=>selector==='#app'?app:feedback,addEventListener(){}},
    sessionStorage:{getItem:key=>saved.get(key),setItem:(key,value)=>saved.set(key,value)},
    fetch:async(url,options)=>{
      try {
        const body=options?JSON.parse(options.body):null;
        const result=body?store.action(body.revision,body.type,body.data):store.snapshot();
        return {ok:true,json:async()=>JSON.parse(JSON.stringify(result))};
      } catch(error) {return {ok:false,json:async()=>({error:error.message})};}
    }
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../public/script.js'),'utf8'),context);
  await new Promise(resolve=>setImmediate(resolve));
  return {app,feedback,saved,act:(type,id)=>vm.runInContext(`action(${JSON.stringify(type)},{id:${id}})`,context)};
}
function seed(t,count) {
  const db=openDatabase(':memory:');t.after(()=>db.close());
  const store=createStore(db),act=(type,data)=>store.action(store.snapshot().revision,type,data);
  for(let i=1;i<=count;i++)db.prepare('INSERT INTO albums VALUES(?,?,?,?,?,?)').run(i,`CD${i}`,'A < B','Title & more','17D',17);
  act('createSource',{label:'14C'});
  for(let i=1;i<=count;i++)act('scan',{id:1,barcode:`CD${i}`});
  act('finishScan',{id:1});act('startSource',{id:1});
  return {store,act};
}
test('client advances groups, undoes a group, and returns home after final source and column groups',async t=>{
  const {store}=seed(t,12),ui=await client(store);
  assert.match(ui.app.innerHTML,/Next 10 \(Enter\)/);
  assert.equal((ui.app.innerHTML.match(/class="album-detail"/g)||[]).length,10);
  assert.match(ui.app.innerHTML,/A &lt; B/);
  await ui.act('nextGroup',1);
  assert.equal(store.snapshot().session.cursor,10);
  assert.match(ui.app.innerHTML,/Finish stack \(Enter\)/);
  assert.equal((ui.app.innerHTML.match(/class="album-detail"/g)||[]).length,2);
  await ui.act('undo',1);assert.equal(store.snapshot().session.cursor,0);
  await ui.act('nextGroup',1);await ui.act('nextGroup',1);
  assert.equal(ui.saved.get('view'),'home');
  assert.match(ui.feedback.textContent,/finished/);
  assert.doesNotMatch(ui.app.innerHTML,/Review|Undo|Resume sorting|<strong>14C<\/strong>/);
  await ui.act('startColumn',17);await ui.act('nextGroup',2);await ui.act('nextGroup',2);
  assert.equal(ui.saved.get('view'),'home');
  assert.match(ui.app.innerHTML,/No column stacks/);
  assert.doesNotMatch(ui.app.innerHTML,/Review|Undo|Resume sorting/);
});
test('refresh with a stale sorting screen never reopens a completed stack',async t=>{
  const {store,act}=seed(t,1);act('nextGroup',{id:1});
  const ui=await client(store,'sort');
  assert.equal(ui.saved.get('view'),'home');
  assert.doesNotMatch(ui.app.innerHTML,/Review|Undo|Resume sorting|Finish stack/);
});
