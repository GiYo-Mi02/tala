import { readFile } from 'node:fs/promises';
import { Kysely, sql, PostgresDialect } from 'kysely';
import { Migrator } from 'kysely/migration';
import pg from 'pg';
import type { Pool, PoolClient } from 'pg';

export function connect(connectionString: string) {
  return new pg.Pool({ connectionString, max: 8, connectionTimeoutMillis: 4000,
    idleTimeoutMillis: 20_000, statement_timeout: 15_000, idle_in_transaction_session_timeout: 30_000 });
}

export async function migrate(connectionString: string) {
  const db = new Kysely({ dialect: new PostgresDialect({ pool: connect(connectionString) }) });
  try {
    const ddl = await readFile(new URL('../migrations/0001_foundation.sql', import.meta.url), 'utf8');
    const migrator = new Migrator({ db, provider: {
      async getMigrations() {
        return { '0001_foundation': { async up(tx) { await sql.raw(ddl).execute(tx); } } };
      },
    } });
    const { error, results } = await migrator.migrateToLatest();
    if (error) throw error;
    return results ?? [];
  } finally { await db.destroy(); }
}

export async function transaction<T>(pool: Pool, run: (db: PoolClient) => Promise<T>): Promise<T> {
  const db = await pool.connect();
  let discard = false;
  try {
    await db.query('BEGIN');
    const result = await run(db);
    await db.query('COMMIT');
    return result;
  } catch (error) {
    try { await db.query('ROLLBACK'); } catch { discard = true; }
    throw error;
  } finally { db.release(discard); }
}

export async function audit(db: PoolClient, actor: string | null, action: string, submissionId: string | null,
  details: Record<string, unknown> = {}, targetUser: string | null = null) {
  await db.query('INSERT INTO audit_logs(actor_id, action, submission_id, details, target_user_id) VALUES ($1,$2,$3,$4,$5)',
    [actor, action, submissionId, details, targetUser]);
}
