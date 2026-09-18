// CENTRAL INVARIANT: virtual top-to-bottom order equals physical top-to-bottom order.
// Scans append (ascending position); column placements push (descending position).
// Next confirms a physical move; Undo must be accompanied by the inverse physical move.
class WorkflowError extends Error {}
const fail = message => { throw new WorkflowError(message); };
function createStore(db) {
  const get = (sql,...args) => db.prepare(sql).get(...args);
  const all = (sql,...args) => db.prepare(sql).all(...args);
  const run = (sql,...args) => db.prepare(sql).run(...args);
  const revision = () => get('SELECT revision FROM state').revision;
  const latest = () => get('SELECT * FROM sessions ORDER BY id DESC LIMIT 1');
  const source = id => get('SELECT * FROM source_stacks WHERE id=?',id) || fail('Source stack not found.');
  const top = column => get('SELECT * FROM column_items WHERE column_id=? ORDER BY position DESC LIMIT 1',column);
  function sessionView(s) {
    if (!s) return null;
    // Preview only: confirmations still move exactly one physical CD per transaction.
    const upcoming = all(`SELECT i.*,a.* FROM session_items i JOIN albums a ON a.id=i.album_id
      WHERE session_id=? AND position>=? ORDER BY position LIMIT 10`,s.id,s.cursor);
    const next = upcoming[0];
    const previous = get(`SELECT i.*,a.* FROM session_items i JOIN albums a ON a.id=i.album_id
      WHERE session_id=? AND position=?`,s.id,s.cursor-1);
    return { ...s, label: s.kind==='source' ? source(s.source_id).label : String(s.column_id), next, previous, upcoming };
  }
  function snapshot() {
    return db.transaction(() => ({ revision: revision(), albumCount: get('SELECT count(*) AS n FROM albums').n,
      sources: all(`SELECT s.*,count(i.album_id) AS count FROM source_stacks s LEFT JOIN source_items i ON s.id=i.source_id
        GROUP BY s.id ORDER BY s.id DESC`).map(s => ({...s, last: get(`SELECT a.* FROM source_items i JOIN albums a ON a.id=i.album_id
          WHERE source_id=? ORDER BY position DESC LIMIT 1`,s.id)})),
      columns: all('SELECT column_id,count(*) AS count FROM column_items GROUP BY column_id ORDER BY column_id'),
      session: sessionView(latest()) }))();
  }
  function mutate(expected, operation) {
    // IMMEDIATE transaction serializes writers; revision rejects retries, stale tabs and double clicks.
    db.transaction(() => {
      if (!Number.isSafeInteger(expected) || expected !== revision()) fail('State changed. Reloaded current progress; check the physical stack before retrying.');
      operation();
      run('UPDATE state SET revision=revision+1 WHERE id=1');
    }).immediate();
    return snapshot();
  }
  function startSession(kind,id) {
    if (get("SELECT id FROM sessions WHERE status='active'")) fail('Resume the current sorting session before starting another.');
    let items;
    if (kind==='source') {
      if (source(id).status!=='ready') fail('Only a finished, unsorted source stack can start sorting.');
      items = all('SELECT album_id,NULL AS column_position FROM source_items WHERE source_id=? ORDER BY position',id);
    } else {
      if (!Number.isInteger(id) || id<1 || id>32) fail('Invalid column.');
      items = all('SELECT album_id,position AS column_position FROM column_items WHERE column_id=? ORDER BY position DESC',id);
    }
    if (!items.length) fail('Cannot sort an empty stack.');
    const sid = Number(run('INSERT INTO sessions(kind,source_id,column_id,total) VALUES(?,?,?,?)',kind,kind==='source'?id:null,kind==='column'?id:null,items.length).lastInsertRowid);
    items.forEach((item,i) => run('INSERT INTO session_items VALUES(?,?,?,?)',sid,i,item.album_id,item.column_position));
    if (kind==='source') run("UPDATE source_stacks SET status='sorting' WHERE id=?",id);
  }
  function move(sid,undo) {
    const s = latest();
    if (!s || s.id!==sid) fail('Only the most recent sorting session can be changed.');
    if (undo ? s.cursor===0 : s.status!=='active') fail(undo?'Nothing to undo.':'This session is complete.');
    const index = undo ? s.cursor-1 : s.cursor;
    const item = get(`SELECT i.*,a.destination_column FROM session_items i JOIN albums a ON a.id=i.album_id
      WHERE session_id=? AND position=?`,sid,index);
    const column = item.destination_column;
    if (s.kind==='source') {
      if (undo) {
        const head = top(column);
        if (!head || head.album_id!==item.album_id || head.position!==item.column_position) fail('Column top does not match. No changes made.');
        run('DELETE FROM column_items WHERE position=?',head.position);
      } else {
        const position = Number(run('INSERT INTO column_items(column_id,album_id) VALUES(?,?)',column,item.album_id).lastInsertRowid);
        run('UPDATE session_items SET column_position=? WHERE session_id=? AND position=?',position,sid,index);
      }
    } else if (undo) {
      const head = top(column);
      if (head && head.position>=item.column_position) fail('Cannot safely restore the column top.');
      if (run('DELETE FROM finished_albums WHERE album_id=? AND session_id=?',item.album_id,sid).changes!==1) fail('Finished album state does not match.');
      run('INSERT INTO column_items VALUES(?,?,?)',item.column_position,column,item.album_id);
    } else {
      const head = top(column);
      if (!head || head.album_id!==item.album_id || head.position!==item.column_position) fail('Column top does not match. No changes made.');
      run('DELETE FROM column_items WHERE position=?',head.position);
      run('INSERT INTO finished_albums VALUES(?,?)',item.album_id,sid);
    }
    const cursor = s.cursor+(undo?-1:1), status = cursor===s.total?'done':'active';
    run('UPDATE sessions SET cursor=?,status=? WHERE id=?',cursor,status,sid);
    if (s.kind==='source') run('UPDATE source_stacks SET status=? WHERE id=?',status==='done'?'done':'sorting',s.source_id);
  }
  return { snapshot, action(expected,type,data={}) {
    return mutate(expected,() => {
      if (type==='createSource') {
        const label = String(data.label || '').trim().toUpperCase();
        if (!/^(?:[1-9]|[12]\d|3[0-2])[A-Z]+$/.test(label)) fail('Use a shelf label such as 14C (columns 1–32).');
        if (get("SELECT id FROM source_stacks WHERE label=? AND status!='done'",label)) fail('This source shelf already has an unfinished stack.');
        run('INSERT INTO source_stacks(label) VALUES(?)',label);
      } else if (type==='scan') {
        if (source(data.id).status!=='scanning') fail('This stack is no longer accepting scans.');
        const barcode = String(data.barcode || '').trim();
        const album = get('SELECT * FROM albums WHERE barcode=?',barcode);
        if (!album) fail('UNKNOWN BARCODE — do not move this CD; correct the barcode or resolve the catalog entry before continuing.');
        if (get('SELECT album_id FROM source_items WHERE album_id=?',album.id)) fail('DUPLICATE — this album has already been scanned. No changes made.');
        const count = get('SELECT count(*) AS n FROM source_items WHERE source_id=?',data.id).n;
        run('INSERT INTO source_items VALUES(?,?,?)',data.id,count,album.id);
      } else if (type==='finishScan') {
        if (source(data.id).status!=='scanning') fail('This source is not being scanned.');
        if (!get('SELECT album_id FROM source_items WHERE source_id=? LIMIT 1',data.id)) fail('Scan at least one album first.');
        run("UPDATE source_stacks SET status='ready' WHERE id=?",data.id);
      } else if (type==='startSource') startSession('source',data.id);
      else if (type==='startColumn') startSession('column',data.id);
      else if (type==='next' || type==='undo') move(data.id,type==='undo');
      else fail('Unknown action.');
    });
  }};
}
module.exports = { createStore, WorkflowError };
