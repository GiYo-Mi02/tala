import type { Pool } from 'pg';
import { audit,transaction } from './db';
import type { PrivateDiskStore } from './storage';

export async function maintenance(pool: Pool, storage: PrivateDiskStore, retentionDays: number, apply: boolean) {
  const expire = await transaction(pool,async db => {
    const rows = (await db.query<{id:string}>(
      "SELECT id FROM submissions WHERE status IN ('DRAFT','UPLOADING') AND updated_at < now()-make_interval(days=>$1) ORDER BY id LIMIT 500 FOR UPDATE",
      [retentionDays])).rows;
    if (apply) for (const {id} of rows) {
      await db.query('DELETE FROM field_values WHERE submission_id=$1',[id]);
      await db.query('DELETE FROM document_pages WHERE submission_id=$1',[id]);
      await db.query("UPDATE submissions SET status='EXPIRED',revision=revision+1,updated_at=now() WHERE id=$1",[id]);
      await audit(db,null,'INCOMPLETE_EXPIRED',id,{ retentionDays });
    }
    await db.query('DELETE FROM sessions WHERE refresh_expires_at < now()-interval \'30 days\' AND $1',[apply]);
    return rows.length;
  });
  const sweep = await transaction(pool,async db => {
    await db.query('SELECT pg_advisory_xact_lock(19381202)');
    const candidates = await storage.oldKeys(Date.now()-86_400_000);
    const {rows} = await db.query<{object_key:string}>('SELECT object_key FROM document_pages WHERE object_key=ANY($1::uuid[])',[candidates]);
    const live = new Set(rows.map(row=>row.object_key));
    const orphans = candidates.filter(key=>!live.has(key));
    if (apply) for (const key of orphans) await storage.remove(key);
    return orphans.length;
  });
  return { apply,incompleteDrafts:expire,unreferencedImages:sweep };
}
