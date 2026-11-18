import { readFile } from 'node:fs/promises';
import { createServer } from 'node:https';
import { config,loadLocalEnv } from './config';
import { connect } from './db';
import { createApp } from './app';
import { PrivateDiskStore } from './storage';

async function start() {
  loadLocalEnv();
  const cfg = config();
  const pool = connect(cfg.DATABASE_URL);
  pool.on('error',()=>console.error('A background database connection was closed.'));
  await pool.query("SELECT id FROM document_templates LIMIT 1");
  const app = createApp(pool,new PrivateDiskStore(cfg.STORAGE_ROOT),cfg);
  const https = cfg.TLS_CERT_FILE && cfg.TLS_KEY_FILE;
  const server = https ? createServer({
    cert:await readFile(cfg.TLS_CERT_FILE!),key:await readFile(cfg.TLS_KEY_FILE!),minVersion:'TLSv1.2',
  },app).listen(cfg.PORT,cfg.HOST) : app.listen(cfg.PORT,cfg.HOST);
  server.requestTimeout = 60_000;
  server.headersTimeout = 15_000;
  server.on('listening',()=>console.log('T.A.L.A. API listening on '+cfg.HOST+':'+cfg.PORT));
  server.on('error',()=>{ console.error('The API could not bind the configured listener.'); process.exitCode=1; void pool.end(); });
  for (const signal of ['SIGINT','SIGTERM'] as const) process.once(signal,()=> {
    server.close(()=>{ void pool.end(); });
  });
}
start().catch(error=>{
  console.error(error instanceof Error && error.message.startsWith('Invalid backend configuration:')
    ? error.message : 'Backend startup failed. Check its environment, TLS files, database connection and migrations.');
  process.exit(1);
});
