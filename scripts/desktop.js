const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { openDatabase, defaultPath } = require('../db/database');
const { createApp, databaseIdentity } = require('../server');

async function main() {
  if (process.platform !== 'win32') throw Error('Use npm start on this computer; this launcher is for Windows.');
  const port = Number(process.env.PORT || 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw Error('PORT must be a number from 1 to 65535.');
  const filename = path.resolve(process.env.SHELF_DB || defaultPath);
  if (!fs.existsSync(filename)) throw Error('No application database found. Run Setup Windows.cmd first.');
  const url = `http://127.0.0.1:${port}`;
  function openBrowser() {
    // URL is constructed solely from a validated numeric port.
    execFile('cmd.exe', ['/d', '/s', '/c', `start "" "${url}"`], error => {
      if (error) console.error(`Open ${url} in your browser. Automatic browser launch failed.`);
    });
  }
  let response;
  try { response = await fetch(url + '/api/health', {signal: AbortSignal.timeout(1500)}); }
  catch (error) {
    if (error.cause?.code !== 'ECONNREFUSED') throw Error(`Could not check port ${port}. Close any old server window and try again.`);
  }
  if (response) {
    const health = await response.json().catch(() => ({}));
    if (!response.ok || health.app !== 'shelf-sorter' || health.database !== databaseIdentity(filename))
      throw Error(`Port ${port} is already used by another app or database. Close that server before starting this copy.`);
    openBrowser();
    return;
  }
  const db = openDatabase(filename);
  if (!db.prepare('SELECT count(*) n FROM albums').get().n) {
    db.close();
    throw Error('The application database has no catalog. See the README import instructions.');
  }
  const server = createApp(db).listen(port, '127.0.0.1', () => {
    console.log(`Shelf Sorter: ${url}`);
    console.log('Keep this window open or minimized while sorting. Ctrl+C stops the app.');
    openBrowser();
  });
  server.on('error', error => {
    db.close();
    console.error(`Could not start Shelf Sorter: ${error.message}`);
    process.exitCode = 1;
  });
  for (const signal of ['SIGINT','SIGTERM']) process.on(signal, () => {
    server.close(() => { db.close(); process.exit(0); });
  });
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
