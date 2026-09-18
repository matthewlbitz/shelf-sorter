let state, busy = false;
let scanId = Number(sessionStorage.getItem('scanId')) || null;
let view = sessionStorage.getItem('view') || 'home';
const app = document.querySelector('#app');
const feedback = document.querySelector('#feedback');
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

function message(text, error = false) {
  feedback.textContent = text;
  feedback.className = error ? 'error' : 'success';
}
function saveView() {
  sessionStorage.setItem('view', view);
  sessionStorage.setItem('scanId', scanId || '');
}
async function load() {
  const response = await fetch('/api/state');
  if (!response.ok) throw Error('Could not load stacks.');
  state = await response.json();
}
async function action(type, data = {}) {
  if (busy) return;
  busy = true;
  render();
  try {
    const response = await fetch('/api/action', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({revision:state.revision, type, data})
    });
    const result = await response.json();
    if (!response.ok) throw Error(result.error);
    state = result;
    let status = '';
    if (type === 'createSource') { scanId = state.sources[0].id; view = 'scan'; }
    if (type === 'startSource' || type === 'startColumn') view = 'sort';
    if (type === 'finishScan') { view = 'home'; status = 'Stack ready to sort.'; }
    if (type === 'scan') status = 'Scanned.';
    if (type === 'undo') status = 'Group undone.';
    if (type === 'nextGroup' && state.session.status === 'done') {
      view = 'home';
      status = `${state.session.kind === 'source' ? 'Source '+state.session.label : 'Column '+state.session.column_id} finished.`;
    }
    message(status);
  } catch (error) {
    message(`${error.message} If you already moved CDs, check their positions before continuing.`, true);
    try { await load(); }
    catch { state = null; message('Connection lost. Stop sorting and reload to recover progress.', true); }
  } finally {
    busy = false;
    saveView();
    render();
  }
}
function button(label, type, id, secondary = false, disabled = false, extra = '') {
  return `<button ${busy || disabled ? 'disabled' : ''} class="${secondary ? 'secondary' : ''} ${extra}" data-action="${type}" ${id === undefined ? '' : `data-id="${id}"`}>${label}</button>`;
}
function renderSort(session) {
  const lastGroup = session.cursor + session.upcoming.length === session.total;
  return `<div class="work-head"><div><h1>${session.kind === 'source' ? `Source ${esc(session.label)} → columns` : `Column ${session.column_id} → shelves`}</h1>
    <p class="progress">${session.cursor + 1}–${session.cursor + session.upcoming.length} of ${session.total} CDs · ${session.cursor} placed</p></div>${button('Back to stacks','home',undefined,true)}</div>
    <section class="panel work">
      <div class="queue-wrap"><table class="queue"><caption class="sr-only">Sort these CDs from top to bottom, in the order shown.</caption>
        <colgroup><col class="order"><col class="destination"><col></colgroup>
        <thead><tr><th scope="col">#</th><th scope="col">${session.kind === 'source' ? 'Column' : 'Shelf'}</th><th scope="col">Album</th></tr></thead>
        <tbody>${session.upcoming.map((album,index) => `<tr ${index === 0 ? 'class="current"' : ''}>
          <th scope="row">${album.position + 1}</th>
          <td class="target">${session.kind === 'source' ? album.destination_column : esc(album.destination_shelf)}</td>
          <td class="album-detail"><strong>${esc(album.artist)} — ${esc(album.title)}</strong><small>${esc(album.barcode)}</small></td>
        </tr>`).join('')}</tbody></table></div>
      <p class="hint">Top to bottom. Place each CD on top of its destination pile.</p>
      <div class="actions">${button(lastGroup ? 'Finish stack (Enter)' : 'Next 10 (Enter)','nextGroup',session.id)}${button('Undo last group','undo',session.id,true,!session.undoItems.length)}</div>
      ${lastGroup ? '<p class="hint">Finish after placing these CDs. Completed stacks cannot be undone.</p>' : ''}
      <details><summary>Pausing or undoing</summary><p>Finish placing all CDs shown before pressing Next 10. To pause, save the group first, then go back to stacks. Undo returns the last saved group in reverse order; return any unsaved moves first.</p></details>
    </section>`;
}
function renderScan(source) {
  return `<div class="work-head"><div><h1>Scan ${esc(source.label)}</h1><p class="progress">${source.count} CDs scanned</p></div>${button('Back to stacks','home',undefined,true)}</div>
    <section class="panel work"><div class="scan-layout"><div><form id="scan"><label for="barcode">Barcode</label>
      <input id="barcode" name="barcode" autocomplete="off" required ${busy ? 'disabled' : ''}>
      <div class="actions"><button ${busy ? 'disabled' : ''}>Scan</button>${button('Finish scanning','finishScan',source.id,true,!source.count)}</div></form>
      <p class="hint">Scan top to bottom. Keep the scanned CDs in that same order.</p>
      <details><summary>Keeping the stack in order</summary><p>Put each scanned CD beneath the ones already scanned. Adding it on top would reverse the stack.</p></details></div>
      <div class="last-scan"><p class="muted">Last scanned</p>${source.last ? `<h2>${esc(source.last.artist)} — ${esc(source.last.title)}</h2><p class="muted">${esc(source.last.barcode)}</p><p class="target">${esc(source.last.destination_shelf)}</p>` : '<p class="empty">No scans yet.</p>'}</div></div></section>`;
}
function renderHome() {
  const session = state.session?.status === 'active' ? state.session : null;
  const sources = state.sources.filter(source => source.status !== 'done');
  return `${!state.albumCount ? '<p class="error">No catalog loaded. See README for import instructions.</p>' : ''}
    ${session ? `<section class="panel resume"><div><strong>${session.kind === 'source' ? `Source ${esc(session.label)}` : `Column ${session.column_id}`}</strong><small>${session.cursor} of ${session.total} placed</small></div>${button('Resume sorting','sort')}</section>` : ''}
    <div class="dashboard"><section class="panel"><h2>Scan a shelf</h2><form id="source"><div class="field"><label for="label">Source shelf</label><input id="label" name="label" placeholder="14C" required maxlength="12"></div><button class="full-width" ${busy || !state.albumCount ? 'disabled' : ''}>Start scanning</button></form></section>
    <div class="dashboard-main"><section class="panel"><div class="panel-head"><h2>Source stacks</h2><span class="muted">${sources.length}</span></div>
    ${sources.map(source => `<div class="row"><div><strong>${esc(source.label)}</strong><small>${source.count} CDs · ${source.status === 'scanning' ? 'Scanning' : source.status === 'ready' ? 'Ready' : 'Sorting'}</small></div>
      ${button(source.status === 'scanning' ? 'Scan' : source.status === 'ready' ? 'Sort' : 'Resume',source.status === 'scanning' ? 'openScan' : source.status === 'ready' ? 'startSource' : 'sort',source.id,true,source.status === 'ready' && !!session)}</div>`).join('') || '<p class="empty">No source stacks.</p>'}</section>
    <section class="panel"><div class="panel-head"><h2>Columns</h2><span class="muted">${state.columns.reduce((total,column) => total + column.count,0)} CDs</span></div>
    <div class="column-grid">${state.columns.map(column => {
      const sorting = session?.kind === 'column' && session.column_id === column.column_id;
      return button(`<strong>${column.column_id}</strong><small>${column.count} CDs${sorting ? ' · Resume' : ''}</small>`,sorting ? 'sort' : 'startColumn',column.column_id,true,!!session && !sorting);
    }).join('')}</div>${!state.columns.length ? '<p class="empty">No column stacks.</p>' : ''}</section></div></div>`;
}
function render() {
  if (!state) { app.innerHTML = '<p>Stacks unavailable.</p><button data-action="reload">Reload</button>'; return; }
  // Completed sessions are history only. Old saved screen selections return home.
  if (view === 'sort' && state.session?.status === 'active') app.innerHTML = renderSort(state.session);
  else if (view === 'scan' && state.sources.some(source => source.id === scanId && source.status === 'scanning')) {
    app.innerHTML = renderScan(state.sources.find(source => source.id === scanId));
    if (!busy) document.querySelector('#barcode').focus();
  } else { view = 'home'; app.innerHTML = renderHome(); }
  saveView();
}
app.addEventListener('submit', event => {
  event.preventDefault();
  if (busy) return;
  const form = new FormData(event.target);
  if (event.target.id === 'source') action('createSource',{label:form.get('label')});
  if (event.target.id === 'scan') action('scan',{id:scanId,barcode:form.get('barcode')});
});
app.addEventListener('click', event => {
  const target = event.target.closest('[data-action]');
  if (!target || busy) return;
  const type = target.dataset.action, id = Number(target.dataset.id);
  if (type === 'reload') { location.reload(); return; }
  if (['home','sort','openScan'].includes(type)) {
    view = type === 'openScan' ? 'scan' : type;
    if (type === 'openScan') scanId = id;
    message(''); render(); return;
  }
  if (type === 'undo') {
    const session = state.session;
    if (session?.status !== 'active' || !session.undoItems.length) return;
    const moves = session.undoItems.map((album,index) => `${index+1}. ${album.barcode}: ${session.kind === 'source' ? 'Column '+album.destination_column : 'Shelf '+album.destination_shelf}`).join('\n');
    const destination = session.kind === 'source' ? `source ${session.label}` : `Column ${session.column_id}`;
    if (!confirm(`Return any unsaved moves first. Then take these CDs from the tops of their piles, in this order, and place each on top of ${destination}:\n\n${moves}\n\nPress OK after returning all ${session.undoItems.length} CDs.`)) return;
  }
  action(type,{id});
});
document.addEventListener('keydown', event => {
  if (view !== 'sort' || state?.session?.status !== 'active') return;
  if (![' ','Enter'].includes(event.key)) return;
  if (event.repeat) { event.preventDefault(); return; }
  if (busy || event.target.closest('button,input,textarea,a,summary')) return;
  event.preventDefault();
  action('nextGroup',{id:state.session.id});
});
load().then(render).catch(error => { message(error.message,true); render(); });
