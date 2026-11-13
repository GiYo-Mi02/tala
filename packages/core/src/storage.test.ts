import { describe, expect, it } from 'vitest';
import clean from '../../../fixtures/expected/clean.json';
import { fieldKeys } from './fields';
import { newDraft, readinessProblems, withPage, type Draft, type Page } from './draft';
import { acceptPage, saveDraft, type DraftPort } from './storage';
const now = '2026-11-12T00:00:00.000Z';
const page = (n: 1 | 2, id = `image-${n}`): Page => ({ page:n, uri:`private://${id}.jpg`, width:1060, height:1495, acceptedAt:now, imageId:id });
function fixtureDraft(): Draft {
  return { ...newDraft('6211494f-09e4-4b71-9724-016c065914d9',now), values:clean.values, pages: {1:page(1),2:page(2)}, confirmed:Object.fromEntries(fieldKeys.map(k => [k,true])), state:'ready' };
}
function memory() {
  const files = new Set([page(1).uri,page(2).uri,'cache://retake.jpg']);
  let row: Draft | undefined; let failWrite = false, failCopy = false;
  const port: DraftPort = {
    exists: async uri => files.has(uri),
    copyToPrivate: async (_source,_id,imageId) => { if(failCopy) throw new Error('copy failed'); const uri=`private://${imageId}.jpg`;files.add(uri);return uri; },
    remove: async uri => { files.delete(uri); },
    write: async draft => { if(failWrite) throw new Error('disk full'); row=JSON.parse(JSON.stringify(draft)); },
  };
  return { port,files,get row(){return row;},set failWrite(v:boolean){failWrite=v;},set failCopy(v:boolean){failCopy=v;} };
}
describe('P1-06: local save faults and readiness', () => {
  it('persists a stable UUID, ordered images, corrections, raw OCR, and readiness',async () => {
    const mem=memory(), draft=fixtureDraft();
    const raw = { text:'R1VERA', crop:{x:0.1,y:0.3,width:0.5,height:0.02},elements:[] };
    draft.ocrHistory=[{id:'ocr-1',pageImageId:'image-1',at:now,engine:'mlkit-bundled-latin-16.0.1',fields:Object.fromEntries(fieldKeys.map(k=>[k,raw])) as never}];
    await saveDraft(mem.port,draft,now);
    expect(mem.row).toEqual(draft); expect(mem.row?.id).toBe(draft.id);
    expect(mem.row?.pages[1]?.imageId).toBe('image-1'); expect(mem.row?.pages[2]?.imageId).toBe('image-2');
    expect(mem.row?.values.learner_last_name).toBe('RIVERA'); expect(mem.row?.ocrHistory[0].fields.learner_last_name.text).toBe('R1VERA');
  });
  it('rejects a missing accepted image without acknowledging a save',async () => {
    const mem=memory();mem.files.delete(page(2).uri);
    await expect(saveDraft(mem.port,fixtureDraft(),now)).rejects.toThrow('missing');expect(mem.row).toBeUndefined();
  });
  it('reports a failed database write',async () => {
    const mem=memory();mem.failWrite=true;
    await expect(saveDraft(mem.port,fixtureDraft(),now)).rejects.toThrow('disk full');expect(mem.row).toBeUndefined();
  });
  it('retains previous accepted page and removes a failed retake copy',async () => {
    const mem=memory();mem.failWrite=true;
    await expect(acceptPage(mem.port,fixtureDraft(),{...page(2,'retake'),uri:'cache://retake.jpg'},now)).rejects.toThrow('disk full');
    expect(mem.files.has(page(2).uri)).toBe(true);expect(mem.files.has('private://retake.jpg')).toBe(false);
  });
  it('does not commit metadata when the persistent image copy fails',async () => {
    const mem=memory();mem.failCopy=true;
    await expect(acceptPage(mem.port,fixtureDraft(),page(2,'retake'),now)).rejects.toThrow('copy failed');expect(mem.row).toBeUndefined();
  });
  it('commits only the accepted replacement and keeps correct page order',async () => {
    const mem=memory();const saved=await acceptPage(mem.port,fixtureDraft(),page(2,'retake'),now);
    expect(saved.pages[1]?.imageId).toBe('image-1');expect(saved.pages[2]?.imageId).toBe('retake');
    expect(mem.files.has(page(2).uri)).toBe(false);expect(saved.state).toBe('editing');
  });
  it('allows unfinished drafts but refuses incomplete ready state',async () => {
    const mem=memory(), draft=newDraft('uuid',now);
    expect((await saveDraft(mem.port,draft,now)).state).toBe('editing');
    await expect(saveDraft(mem.port,{...draft,state:'ready'},now)).rejects.toThrow('incomplete');
  });
  it('requires both pages, valid values, and every confirmation',() => {
    const draft=fixtureDraft();expect(readinessProblems(draft)).toEqual([]);
    expect(readinessProblems({...draft,pages:{1:page(1)}})).toContain('Accept page 2.');
    expect(readinessProblems({...draft,values:{...draft.values,birth_date:'2014-02-30'}}).length).toBeGreaterThan(0);
    expect(readinessProblems({...draft,confirmed:{}}).length).toBeGreaterThan(0);
  });
  it('invalidates all confirmations and readiness on page 1 retake',() => {
    const replacement=withPage(fixtureDraft(),page(1,'replacement'));
    expect(replacement.confirmed).toEqual({});expect(replacement.state).toBe('editing');
  });
});
