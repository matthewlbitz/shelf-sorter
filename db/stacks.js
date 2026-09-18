// CENTRAL INVARIANT: virtual top-to-bottom order equals physical top-to-bottom order.
// Scans append (ascending position); column placements push (descending position).
// Next confirms the displayed group in sequence; Undo reverses the group in reverse order.
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
  const itemFields = 'i.*,a.artist,a.title,a.destination_shelf,a.destination_column';
  function sessionView(s) {
    if (!s) return null;
    // This is the next group, taken directly from the durable session order.
    const upcoming = all(`SELECT ${itemFields} FROM session_items i LEFT JOIN albums a ON a.id=i.album_id
      WHERE session_id=? AND position>=? ORDER BY position LIMIT 10`,s.id,s.cursor);
    const next = upcoming[0];
    const previous = get(`SELECT ${itemFields} FROM session_items i LEFT JOIN albums a ON a.id=i.album_id
      WHERE session_id=? AND position=?`,s.id,s.cursor-1);
    const lastAction = get('SELECT * FROM session_actions WHERE session_id=? AND start_cursor+count=?',s.id,s.cursor);
    // Existing sessions created before group confirmations have one-CD undo history.
    const undoCount = s.status==='active' ? (lastAction?.count || Math.min(s.cursor,1)) : 0;
    const undoItems = all(`SELECT ${itemFields} FROM session_items i LEFT JOIN albums a ON a.id=i.album_id
      WHERE session_id=? AND position>=? AND position<? ORDER BY position DESC`,s.id,s.cursor-undoCount,s.cursor);
    return { ...s, label: s.kind==='source' ? source(s.source_id).label : String(s.column_id), next, previous, upcoming, undoItems };
  }
  function snapshot() {
    return db.transaction(() => ({ revision: revision(), albumCount: get('SELECT count(*) AS n FROM albums').n,
      sources: all(`SELECT s.*,count(i.position) AS count FROM source_stacks s LEFT JOIN source_items i ON s.id=i.source_id
        GROUP BY s.id ORDER BY s.id DESC`).map(s => ({...s, last: get(`SELECT ${itemFields} FROM source_items i LEFT JOIN albums a ON a.id=i.album_id
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
      items = all('SELECT album_id,barcode,NULL AS column_position FROM source_items WHERE source_id=? ORDER BY position',id);
    } else {
      if (!Number.isInteger(id) || id<1 || id>32) fail('Invalid column.');
      items = all('SELECT c.album_id,a.barcode,c.position AS column_position FROM column_items c JOIN albums a ON a.id=c.album_id WHERE column_id=? ORDER BY c.position DESC',id);
    }
    if (!items.length) fail('Cannot sort an empty stack.');
    const sid = Number(run('INSERT INTO sessions(kind,source_id,column_id,total) VALUES(?,?,?,?)',kind,kind==='source'?id:null,kind==='column'?id:null,items.length).lastInsertRowid);
    items.forEach((item,i) => run('INSERT INTO session_items VALUES(?,?,?,?,?)',sid,i,item.album_id,item.column_position,item.barcode));
    if (kind==='source') run("UPDATE source_stacks SET status='sorting' WHERE id=?",id);
  }
  function move(sid,undo) {
    const s = latest();
    if (!s || s.id!==sid) fail('Only the most recent sorting session can be changed.');
    if (s.status!=='active') fail('This session is complete.');
    if (undo && s.cursor===0) fail('Nothing to undo.');
    const index = undo ? s.cursor-1 : s.cursor;
    const item = get(`SELECT i.*,a.destination_column FROM session_items i LEFT JOIN albums a ON a.id=i.album_id
      WHERE session_id=? AND position=?`,sid,index);
    const column = item.destination_column;
    // Unknown CDs occupy a real source position; their destination is the set-aside pile.
    // Its order is the processed unknown session items, in descending position.
    if (item.album_id===null) {
      if (s.kind!=='source') fail('Unknown CD in a column stack. No changes made.');
    } else if (s.kind==='source') {
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
      run('INSERT INTO column_items VALUES(?,?,?)',item.column_position,column,item.album_id);
    } else {
      const head = top(column);
      if (!head || head.album_id!==item.album_id || head.position!==item.column_position) fail('Column top does not match. No changes made.');
      run('DELETE FROM column_items WHERE position=?',head.position);
    }
    const cursor = s.cursor+(undo?-1:1), status = cursor===s.total?'done':'active';
    run('UPDATE sessions SET cursor=?,status=? WHERE id=?',cursor,status,sid);
    if (s.kind==='source') run('UPDATE source_stacks SET status=? WHERE id=?',status==='done'?'done':'sorting',s.source_id);
  }
  function advance(sid,limit) {
    const s=latest();
    if (!s || s.id!==sid) fail('Only the most recent sorting session can be changed.');
    if (s.status!=='active') fail('This session is complete.');
    const count=Math.min(limit,s.total-s.cursor);
    run('INSERT INTO session_actions VALUES(?,?,?)',sid,s.cursor,count);
    // All pushes/pops, the group boundary and progress share the outer transaction.
    for(let i=0;i<count;i++) move(sid,false);
  }
  function undoGroup(sid) {
    const s=latest();
    if (!s || s.id!==sid) fail('Only the most recent sorting session can be changed.');
    if (s.status!=='active') fail('This session is complete.');
    if (!s.cursor) fail('Nothing to undo.');
    const lastAction=get('SELECT * FROM session_actions WHERE session_id=? AND start_cursor+count=?',sid,s.cursor);
    const count=lastAction?.count || 1;
    for(let i=0;i<count;i++) move(sid,true);
    if(lastAction) run('DELETE FROM session_actions WHERE session_id=? AND start_cursor=?',sid,lastAction.start_cursor);
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
        if (!barcode) fail('Barcode is empty.');
        if (get('SELECT position FROM source_items WHERE source_id=? AND barcode=?',data.id,barcode))
          fail('DUPLICATE — this barcode is already in this source stack.');
        const album = get('SELECT * FROM albums WHERE barcode=?',barcode);
        if (album) {
          const inSource = get(`SELECT s.label FROM source_items i JOIN source_stacks s ON s.id=i.source_id
            WHERE i.album_id=? AND (s.status IN ('scanning','ready') OR
              (s.status='sorting' AND i.position >= (SELECT cursor FROM sessions WHERE source_id=s.id AND status='active')))`,album.id);
          const inColumn = get('SELECT column_id FROM column_items WHERE album_id=?',album.id);
          const undoable = get(`SELECT s.id FROM session_items i JOIN sessions s ON s.id=i.session_id
            WHERE i.album_id=? AND s.kind='column' AND s.status='active' AND i.position<s.cursor`,album.id);
          if (inSource || inColumn || undoable) fail('This CD is still part of an unfinished stack. Finish that sort before scanning it into another stack.');
        }
        const count = get('SELECT count(*) AS n FROM source_items WHERE source_id=?',data.id).n;
        run('INSERT INTO source_items VALUES(?,?,?,?)',data.id,count,album?.id ?? null,barcode);
      } else if (type==='finishScan') {
        if (source(data.id).status!=='scanning') fail('This source is not being scanned.');
        if (!get('SELECT album_id FROM source_items WHERE source_id=? LIMIT 1',data.id)) fail('Scan at least one album first.');
        run("UPDATE source_stacks SET status='ready' WHERE id=?",data.id);
      } else if (type==='startSource') startSession('source',data.id);
      else if (type==='startColumn') startSession('column',data.id);
      else if (type==='nextGroup') advance(data.id,10);
      else if (type==='next') advance(data.id,1); // Compatibility with existing clients.
      else if (type==='undo') undoGroup(data.id);
      else fail('Unknown action.');
    });
  }};
}
module.exports = { createStore, WorkflowError };
