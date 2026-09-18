let state, busy=false;
let scanId=Number(sessionStorage.getItem('scanId')) || null;
let view=sessionStorage.getItem('view') || 'home';
const app=document.querySelector('#app'), feedback=document.querySelector('#feedback');
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function message(text,error=false){feedback.textContent=text;feedback.className=error?'error':'success';}
function saveView(){sessionStorage.setItem('view',view);sessionStorage.setItem('scanId',scanId || '');}
async function load(){const response=await fetch('/api/state');if(!response.ok)throw Error('Could not load database state.');state=await response.json();}
async function action(type,data={},success=''){
  if(busy)return;
  busy=true;render();
  try{
    const response=await fetch('/api/action',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({revision:state.revision,type,data})});
    const result=await response.json();
    if(!response.ok)throw Error(result.error);
    state=result;
    if(type==='createSource'){scanId=state.sources[0].id;view='scan';}
    if(type==='startSource'||type==='startColumn')view='sort';
    if(type==='finishScan')view='home';
    message(success || 'Saved.');
  }catch(error){
    message(`${error.message} If a CD was already moved, reconcile it with the saved instruction before continuing.`,true);
    try{await load();}catch{state=null;message('Connection/database unavailable. Stop moving CDs. Reload to recover saved progress.',true);}
  }finally{busy=false;saveView();render();}
}
const button=(label,type,id,secondary=false)=>`<button ${busy?'disabled':''} class="${secondary?'secondary':''}" data-action="${type}" ${id===undefined?'':`data-id="${id}"`}>${label}</button>`;
function render(){
  if(!state){app.innerHTML='<p>Cannot safely show instructions.</p><button data-action="reload">Reload saved state</button>';return;}
  const session=state.session;
  if(view==='sort' && session){
    const done=session.status==='done';
    app.innerHTML=`${button('← Home','home',undefined,true)}<section class="instruction"><h1>SORTING ${session.kind==='source'?esc(session.label):`COLUMN ${session.column_id}`}</h1>
      <p class="progress">${done?session.total:session.cursor+1} / ${session.total}${done?' — Complete':''}</p>
      <div class="actions">${done?'':button('Moved top CD — Next','next',session.id)}${session.cursor?button('Undo Last','undo',session.id,true):''}</div>
      <p class="notice">${session.kind==='source'?'Place each CD ON TOP of its destination column stack.':'Place each CD ON TOP of its destination shelf pile. Keep piles accessible for Undo.'} Move and confirm one CD at a time, starting with the highlighted row.</p>
      ${done?'<h2>All moves saved.</h2>':`<h2 class="queue-heading">Next ${session.upcoming.length} albums · top to bottom</h2>
        <div class="queue-wrap"><table class="queue"><caption class="sr-only">Upcoming albums in physical stack order. The first row is the next CD to move.</caption>
          <thead><tr><th scope="col">Order</th><th scope="col">Album / barcode</th><th scope="col">Put on ${session.kind==='source'?'column':'shelf'}</th></tr></thead>
          <tbody>${session.upcoming.map((album,index)=>`<tr ${index===0?'class="current" aria-current="step"':''}>
            <th scope="row"><span class="sequence">${album.position+1}</span>${index===0?'<small>MOVE NEXT</small>':''}</th>
            <td><strong>${esc(album.artist)}</strong><span class="album-title">${esc(album.title)}</span><small>Barcode ${esc(album.barcode)}</small></td>
            <td class="target">${session.kind==='source'?album.destination_column:esc(album.destination_shelf)}</td>
          </tr>`).join('')}</tbody>
        </table></div>`}
      <p class="muted">Space or Enter confirms one move. The list advances one album at a time. Undo restores the previous top CD.</p></section>`;
  }else if(view==='scan' && state.sources.some(s=>s.id===scanId && s.status==='scanning')){
    const s=state.sources.find(s=>s.id===scanId);
    app.innerHTML=`${button('← Home','home',undefined,true)}<section><h1>Scanning ${esc(s.label)}</h1><h2>${s.count} CDs scanned</h2><p class="notice">Scan TOP to BOTTOM. Keep that exact order: put each scanned CD beneath the previous scanned CDs, or rebuild the original order before sorting. Do not reverse the stack.</p><form id="scan"><label for="barcode">Barcode</label><input id="barcode" name="barcode" autocomplete="off" required ${busy?'disabled':''}><button ${busy?'disabled':''}>Scan</button></form><p>${s.last?`Last: ${esc(s.last.artist)} — ${esc(s.last.title)} · Shelf <strong>${esc(s.last.destination_shelf)}</strong>`:'Ready for the first CD.'}</p>${button('Finish Scanning','finishScan',s.id)}</section>`;
    if(!busy)document.querySelector('#barcode').focus();
  }else{
    view='home';
    app.innerHTML=`<h1>Keep every stack in order.</h1><p>Scan once, sort into columns, then sort each column into shelves.</p>${!state.albumCount?'<p class="error">No albums imported. Run the import command in the README before scanning.</p>':''}
      ${session?`<section><h2>${session.status==='active'?'Sorting in progress':'Most recent sort complete'}</h2><p>${session.kind==='source'?esc(session.label):`Column ${session.column_id}`} · ${session.cursor} / ${session.total} moved</p>${button(session.status==='active'?'Resume sorting':'Review / Undo last move','sort')}</section>`:''}
      <section><h2>1. Scan an Unsorted Shelf</h2><form id="source"><label for="label">Source shelf</label><input id="label" name="label" placeholder="14C" required maxlength="12"><button ${busy||!state.albumCount?'disabled':''}>Start scanning</button></form></section>
      <section><h2>2. Unsorted Shelves</h2>${state.sources.filter(s=>s.status!=='done').map(s=>`<div class="row"><span><strong>${esc(s.label)}</strong> — ${s.count} CDs<small>${s.status==='scanning'?'Scanning':s.status==='ready'?'Ready to sort':'Sorting in progress'}</small></span>${button(s.status==='scanning'?'Resume scanning':s.status==='ready'?'Sort into columns':'Resume sorting',s.status==='scanning'?'openScan':s.status==='ready'?'startSource':'sort',s.id)}</div>`).join('')||'<p class="muted">No unfinished source stacks.</p>'}</section>
      <section><h2>3. Column Stacks</h2>${state.columns.map(c=>`<div class="row"><span><strong>Column ${c.column_id}</strong> — ${c.count} CDs<small>${session?.status==='active'&&session.kind==='column'&&session.column_id===c.column_id?'Sorting in progress':'Top-to-bottom order saved'}</small></span>${button('Sort into shelves',session?.status==='active'&&session.kind==='column'&&session.column_id===c.column_id?'sort':'startColumn',c.column_id)}</div>`).join('')||'<p class="muted">Column stacks are empty.</p>'}</section>`;
  }
  saveView();
}
app.addEventListener('submit',event=>{
  event.preventDefault(); if(busy)return;
  const form=new FormData(event.target);
  if(event.target.id==='source')action('createSource',{label:form.get('label')});
  if(event.target.id==='scan')action('scan',{id:scanId,barcode:form.get('barcode')},'Scan saved. Keep the scanned stack in its original order.');
});
app.addEventListener('click',async event=>{
  const target=event.target.closest('[data-action]');if(!target||busy)return;
  const type=target.dataset.action,id=Number(target.dataset.id);
  if(type==='reload'){location.reload();return;}
  if(['home','sort','openScan'].includes(type)){view=type==='openScan'?'scan':type;if(type==='openScan')scanId=id;feedback.textContent='';render();return;}
  if(type==='undo'){
    const s=state.session,p=s.previous;
    const instruction=s.kind==='source'?`Return the TOP CD (${p.barcode}) from Column ${p.destination_column} to the TOP of source ${s.label}.`:`Return the last CD (${p.barcode}) from the TOP of shelf pile ${p.destination_shelf} to the TOP of Column ${s.column_id}.`;
    if(!confirm(`${instruction}\n\nPress OK after reversing this physical move to save Undo. Cancel leaves the database unchanged.`))return;
  }
  action(type,{id},type==='undo'?'Last move undone.':type==='next'?'Move saved.':'Saved.');
});
document.addEventListener('keydown',event=>{
  if(view!=='sort'||!state||state.session?.status!=='active')return;
  if(event.repeat && [' ','Enter'].includes(event.key)){event.preventDefault();return;}
  if(busy)return;
  if(![' ','Enter'].includes(event.key)||event.target.closest('button,input,textarea,a'))return;
  event.preventDefault();action('next',{id:state.session.id},'Move saved.');
});
load().then(render).catch(error=>{message(error.message,true);render();});
