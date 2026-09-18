const express = require('express');
const path = require('node:path');
const { openDatabase } = require('./db/database');
const { createStore, WorkflowError } = require('./db/stacks');
function createApp(db) {
  const app=express(), store=createStore(db);
  app.use((req,res,next)=>{
    res.set('Cache-Control','no-store');
    res.set('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; frame-ancestors 'none'");
    const origin=req.get('origin');
    if (origin && origin!==`${req.protocol}://${req.get('host')}`) return res.status(403).json({error:'Cross-origin requests are not allowed.'});
    next();
  });
  app.use(express.json({limit:'8kb'}));
  app.get('/api/state',(req,res,next)=>{try{res.json(store.snapshot());}catch(e){next(e);}});
  app.post('/api/action',(req,res,next)=>{
    try {res.json(store.action(req.body.revision,req.body.type,req.body.data));}catch(e){next(e);}
  });
  app.use(express.static(path.join(__dirname,'public')));
  app.use((error,req,res,next)=>{
    if (!(error instanceof WorkflowError)) console.error(error);
    res.status(error instanceof WorkflowError?409:500).json({error:error instanceof WorkflowError?error.message:'Database or request failure. Check the physical stack and reload before continuing.'});
  });
  return app;
}
if(require.main===module) {
  const db=openDatabase(process.env.SHELF_DB);
  const port=Number(process.env.PORT || 3000);
  const server=createApp(db).listen(port,'127.0.0.1',()=>console.log(`Shelf Sorter: http://127.0.0.1:${port}`));
  for(const signal of ['SIGINT','SIGTERM']) process.on(signal,()=>server.close(()=>{db.close();process.exit(0);}));
}
module.exports={createApp};
