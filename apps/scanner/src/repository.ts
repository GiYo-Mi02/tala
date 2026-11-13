import * as SQLite from 'expo-sqlite';
import * as FS from 'expo-file-system/legacy';
import { acceptPage, saveDraft, TEST_PROFILE, type Draft, type DraftPort, type Page } from '@tala/core';

const database = SQLite.openDatabaseAsync('tala-phase1.db');
const root = `${FS.documentDirectory}tala-drafts/`;

export async function initializeRepository() {
  if (!FS.documentDirectory) throw new Error('Private app storage is unavailable.');
  await FS.makeDirectoryAsync(root, { intermediates: true });
  const db = await database;
  await db.execAsync(`PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL;
    CREATE TABLE IF NOT EXISTS drafts (id TEXT PRIMARY KEY, profile_id TEXT NOT NULL, body TEXT NOT NULL, updated_at TEXT NOT NULL);
    PRAGMA user_version = 1;`);
  // A crash between image copy and metadata commit can leave a private orphan. Clean only unreferenced files.
  const drafts = await listDrafts();
  const referenced = new Set(drafts.flatMap(d => Object.values(d.pages).map(p => p?.uri)));
  for (const dir of await FS.readDirectoryAsync(root)) {
    const folder = `${root}${dir}/`;
    const info = await FS.getInfoAsync(folder);
    if (!info.exists || !info.isDirectory) continue;
    for (const file of await FS.readDirectoryAsync(folder)) {
      if (!referenced.has(`${folder}${file}`)) await FS.deleteAsync(`${folder}${file}`, { idempotent: true });
    }
  }
}
export async function listDrafts(): Promise<Draft[]> {
  const rows = await (await database).getAllAsync<{ body: string }>('SELECT body FROM drafts WHERE profile_id = ? ORDER BY updated_at DESC', TEST_PROFILE);
  return rows.map(r => JSON.parse(r.body) as Draft);
}
export async function missingPages(draft: Draft): Promise<number[]> {
  const missing: number[] = [];
  for (const n of [1, 2] as const) if (draft.pages[n] && !(await port.exists(draft.pages[n]!.uri))) missing.push(n);
  return missing;
}
const port: DraftPort = {
  async exists(uri) { const info = await FS.getInfoAsync(uri); return info.exists && !info.isDirectory && info.size > 0; },
  async copyToPrivate(source, draftId, imageId) {
    const directory = `${root}${draftId}/`;
    await FS.makeDirectoryAsync(directory, { intermediates: true });
    const target = `${directory}${imageId}.jpg`;
    try {
      await FS.copyAsync({ from: source, to: target });
      const info = await FS.getInfoAsync(target);
      if (!info.exists || info.isDirectory || info.size === 0) throw new Error('Image copy failed.');
      return target;
    } catch {
      await FS.deleteAsync(target, { idempotent: true }).catch(() => {});
      throw new Error('Could not save this image to private storage. Free storage and try again.');
    }
  },
  async remove(uri) { await FS.deleteAsync(uri, { idempotent: true }); },
  async write(draft) {
    const db = await database;
    await db.withExclusiveTransactionAsync(async tx => {
      const result = await tx.runAsync(`INSERT INTO drafts(id, profile_id, body, updated_at) VALUES (?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET body=excluded.body, updated_at=excluded.updated_at WHERE drafts.profile_id=excluded.profile_id`,
        draft.id, draft.profileId, JSON.stringify(draft), draft.updatedAt);
      if (result.changes !== 1) throw new Error('Draft profile mismatch. This draft was not saved.');
    });
  },
};
export const persistDraft = (draft: Draft) => saveDraft(port, draft, new Date().toISOString());
export const persistPage = (draft: Draft, page: Page) => acceptPage(port, draft, page, new Date().toISOString());
export async function discardCache(uri: string) {
  if (FS.cacheDirectory && uri.startsWith(FS.cacheDirectory)) await FS.deleteAsync(uri, { idempotent: true });
}
