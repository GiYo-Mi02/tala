import * as SQLite from 'expo-sqlite';
import * as FS from 'expo-file-system/legacy';
import { TEST_PROFILE, fixedTemplate, saveFixed, acceptFixedPage, type FixedDraft, type FixedPage, type FixedPort, type FixedRun } from '@tala/core';

const db = SQLite.openDatabaseAsync('tala-phase1.db');
const root = `${FS.documentDirectory}tala-fixed-forms/`;
export async function initializeFixedRepository() {
  if (!FS.documentDirectory) throw new Error('Private storage is unavailable.');
  await FS.makeDirectoryAsync(root,{intermediates:true});
  await (await db).execAsync(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
    CREATE TABLE IF NOT EXISTS fixed_form_drafts(id TEXT PRIMARY KEY,profile_id TEXT NOT NULL,body TEXT NOT NULL,updated_at TEXT NOT NULL);`);
  const drafts = await listFixedDrafts();
  const used = new Set(drafts.flatMap(d=>Object.values(d.pages).map(p=>p?.uri)));
  for(const name of await FS.readDirectoryAsync(root)) {
    const dir=`${root}${name}/`;const info=await FS.getInfoAsync(dir);
    if(info.exists && info.isDirectory)for(const file of await FS.readDirectoryAsync(dir))
      if(!used.has(dir+file))await FS.deleteAsync(dir+file,{idempotent:true});
  }
}
export async function listFixedDrafts():Promise<FixedDraft[]> {
  const rows=await (await db).getAllAsync<{body:string}>('SELECT body FROM fixed_form_drafts WHERE profile_id=? ORDER BY updated_at DESC',TEST_PROFILE);
  return rows.map(r=>JSON.parse(r.body) as FixedDraft);
}
export async function missingFixedPages(draft:FixedDraft):Promise<number[]> {
  const missing:number[]=[];
  for(const p of Object.values(draft.pages))if(p && !(await port.exists(p.uri)))missing.push(p.page);
  return missing;
}
const port:FixedPort={
  async exists(uri){const f=await FS.getInfoAsync(uri);return f.exists && !f.isDirectory && f.size>0;},
  async copy(source,draftId,imageId){
    if(!/^[a-zA-Z0-9-]+$/.test(draftId) || !/^[a-zA-Z0-9-]+$/.test(imageId))throw new Error('Invalid draft/image identity.');
    const dir=`${root}${draftId}/`;await FS.makeDirectoryAsync(dir,{intermediates:true});const target=`${dir}${imageId}.jpg`;
    try {await FS.copyAsync({from:source,to:target});if(!(await port.exists(target)))throw new Error('Empty image copy.');return target;}
    catch {await FS.deleteAsync(target,{idempotent:true}).catch(()=>{});throw new Error('The image could not be saved. Check storage and retry.');}
  },
  async remove(uri){if(uri.startsWith(root))await FS.deleteAsync(uri,{idempotent:true});},
  async write(draft){
    fixedTemplate(draft.templateId,draft.templateVersion);
    await (await db).withExclusiveTransactionAsync(async tx=>{
      const result=await tx.runAsync(`INSERT INTO fixed_form_drafts(id,profile_id,body,updated_at) VALUES(?,?,?,?)
        ON CONFLICT(id) DO UPDATE SET body=excluded.body,updated_at=excluded.updated_at WHERE fixed_form_drafts.profile_id=excluded.profile_id`,
      draft.id,draft.profileId,JSON.stringify(draft),draft.updatedAt);
      if(result.changes!==1)throw new Error('The draft profile does not match. Nothing was saved.');
    });
  },
};
export const persistFixedDraft=(draft:FixedDraft)=>saveFixed(port,draft,new Date().toISOString());
export const persistFixedPage=(draft:FixedDraft,page:FixedPage,run:FixedRun|undefined,replace:boolean)=>acceptFixedPage(port,draft,page,run,replace,new Date().toISOString());
