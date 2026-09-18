const {test}=require('node:test');
const assert=require('node:assert/strict');
const http=require('node:http');
const {Duplex}=require('node:stream');
const {openDatabase}=require('../db/database');
const {createApp,databaseIdentity}=require('../server');
// Exercise the real Express middleware/router without binding a network port.
// This also runs in environments that forbid local listening sockets.
function request(app,url,body,extraHeaders={}) {
  return new Promise((resolve,reject)=>{
    const socket=new Duplex({read(){},write(chunk,encoding,callback){callback();}});
    const req=new http.IncomingMessage(socket);
    req.url=url;req.method=body===undefined?'GET':'POST';
    const payload=body===undefined?null:JSON.stringify(body);
    req.headers={host:'127.0.0.1:3000',...(payload?{'content-type':'application/json','content-length':String(Buffer.byteLength(payload))}:{}),...extraHeaders};
    const res=new http.ServerResponse(req), chunks=[];
    res.write=(chunk)=>{chunks.push(Buffer.from(chunk));return true;};
    res.end=(chunk)=>{
      if(chunk)chunks.push(Buffer.from(chunk));
      res.emit('finish');
      const text=Buffer.concat(chunks).toString();
      resolve({status:res.statusCode,text,json:()=>JSON.parse(text)});
      return res;
    };
    req.on('error',reject);res.on('error',reject);
    app(req,res);
    if(payload)req.push(payload);
    req.push(null);
  });
}
test('Express workflow, stale requests, static UI and cross-origin rejection',async t=>{
  const db=openDatabase(':memory:');t.after(()=>db.close());
  for(let i=1;i<=12;i++) db.prepare('INSERT INTO albums VALUES(?,?,?,?,?,?)').run(i,String(i).padStart(3,'0'),'Artist','Album '+i,'17D',17);
  const app=createApp(db);
  const home=await request(app,'/');assert.equal(home.status,200);assert.match(home.text,/KTRU Shelf Sorter/);
  const health=(await request(app,'/api/health')).json();
  assert.equal(health.app,'shelf-sorter');
  assert.equal(health.database,databaseIdentity(db.name));
  let state=(await request(app,'/api/state')).json();
  async function act(type,data){const res=await request(app,'/api/action',{revision:state.revision,type,data});assert.equal(res.status,200);state=res.json();}
  await act('createSource',{label:'14C'});
  for(let i=1;i<=12;i++) await act('scan',{id:1,barcode:String(i).padStart(3,'0')});
  await act('finishScan',{id:1});
  await act('startSource',{id:1});await act('nextGroup',{id:1});assert.equal(state.columns[0].count,10);
  await act('undo',{id:1});assert.equal(state.columns.length,0);
  await act('nextGroup',{id:1});await act('nextGroup',{id:1});
  const completedSource=await request(app,'/api/action',{revision:state.revision,type:'undo',data:{id:1}});
  assert.equal(completedSource.status,409);assert.match(completedSource.json().error,/complete/);
  await act('startColumn',{id:17});assert.equal(state.session.next.destination_shelf,'17D');
  await act('nextGroup',{id:2});await act('nextGroup',{id:2});assert.equal(state.columns.length,0);
  const completedColumn=await request(app,'/api/action',{revision:state.revision,type:'undo',data:{id:2}});
  assert.equal(completedColumn.status,409);assert.match(completedColumn.json().error,/complete/);
  const stale=await request(app,'/api/action',{revision:0,type:'undo',data:{id:2}});assert.equal(stale.status,409);
  const foreign=await request(app,'/api/action',{}, {origin:'https://example.com'});assert.equal(foreign.status,403);
});
