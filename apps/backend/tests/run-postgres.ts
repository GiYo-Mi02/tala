import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdirSync,mkdtempSync,writeFileSync,unlinkSync } from 'node:fs';
import { createServer } from 'node:net';
import { join,resolve } from 'node:path';

const work = resolve('../../.cache/tala-backend-tests');
mkdirSync(work,{recursive:true,mode:0o700});
const dir = mkdtempSync(join(work,'run-'));
const data = join(dir,'db');
const bin = process.env.PG_BIN ?? (process.platform==='win32' ? 'C:/Program Files/PostgreSQL/18/bin' : '');
const binary = (name: string) => bin ? join(bin,name+(process.platform==='win32'?'.exe':'')) : name;
function run(name: string,args: string[]) {
  const result = spawnSync(binary(name),args,{stdio:'inherit',windowsHide:true});
  if (result.status!==0) throw new Error(name+' failed'+(result.error ? ': '+(result.error as NodeJS.ErrnoException).code : ''));
}
async function availablePort() {
  const probe = createServer();
  await new Promise<void>((resolve,reject)=>{probe.once('error',reject);probe.listen(0,'127.0.0.1',()=>resolve());});
  const address = probe.address();
  if (!address || typeof address==='string') throw new Error('TCP port unavailable');
  await new Promise<void>(resolve=>probe.close(()=>resolve()));
  return address.port;
}
async function main() {
  const port = await availablePort();
  const password = randomBytes(32).toString('hex');
  const pwFile = join(dir,'init-secret');
  writeFileSync(pwFile,password+'\n',{mode:0o600,flag:'wx'});
  try {
    run('initdb',['-D',data,'-U','tala_test','--pwfile='+pwFile,'-A','scram-sha-256','--encoding=UTF8','--locale=C','--no-instructions']);
  } finally { unlinkSync(pwFile); }
  let started=false;
  try {
    run('pg_ctl',['-D',data,'-l',join(dir,'postgres.log'),'-o','-h 127.0.0.1 -p '+port,'-w','start']);
    started=true;
    const files=['tests/unit.test.ts','tests/openapi.test.ts','tests/integration.test.ts'];
    if (process.env.TALA_SYNC_HOST_CLASSPATH) files.push('tests/mobile-sync.test.ts');
    if (process.env.TALA_WEB_TEST==='1') files.push('tests/web.test.ts');
    const result = spawnSync(process.execPath,['--import','tsx','--test',...files],{
      stdio:'inherit',windowsHide:true,env:{...process.env,TALA_TEST_DATABASE_URL:'postgresql://tala_test:'+password+'@127.0.0.1:'+port+'/postgres',
        TALA_TEST_STORAGE:join(dir,'objects'),TALA_ISOLATED_TEST_CLUSTER:'1'},
    });
    process.exitCode=result.status??1;
  } finally {
    if(started)run('pg_ctl',['-D',data,'-m','fast','-w','stop']);
  }
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
