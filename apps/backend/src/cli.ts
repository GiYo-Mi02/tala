import { config,loadLocalEnv } from './config';
import { connect,migrate } from './db';
import { seedTemplates } from './templates';
import { userCreate } from './contracts';
import { provision } from './auth';
import { maintenance } from './maintenance';
import { PrivateDiskStore } from './storage';

async function main() {
  loadLocalEnv();
  const cfg = config();
  const cmd = process.argv[2];
  if (cmd==='migrate') {
    const result = await migrate(cfg.DATABASE_URL);
    console.log('Database migrations current. Applied: '+result.filter(r=>r.status==='Success').length);
    return;
  }
  const pool = connect(cfg.DATABASE_URL);
  try {
    if (cmd==='seed') {
      await seedTemplates(pool);
      console.log('BEEF and SSS E-1 template versions seeded.');
    } else if (cmd==='provision') {
      const input = userCreate.safeParse({ email:process.env.TALA_USER_EMAIL,password:process.env.TALA_USER_PASSWORD,role:process.env.TALA_USER_ROLE });
      if (!input.success) throw new Error('Set TALA_USER_EMAIL, TALA_USER_PASSWORD (at least 12 characters), and TALA_USER_ROLE.');
      const account = await provision(pool,input.data,null);
      console.log('Created '+account.role+' user '+account.id);
    } else if (cmd==='maintenance') {
      console.log(JSON.stringify(await maintenance(pool,new PrivateDiskStore(cfg.STORAGE_ROOT),cfg.RETAIN_INCOMPLETE_DAYS,process.argv.includes('--apply'))));
    } else throw new Error('Unknown backend command.');
  } finally { await pool.end(); }
}
main().catch(error=> {
  if (error instanceof Error && (error.message.startsWith('Set TALA_USER_') || error.message.startsWith('Invalid backend configuration:'))) console.error(error.message);
  else console.error('Backend command failed. Check configuration, database permissions and command inputs.');
  process.exitCode=1;
});
