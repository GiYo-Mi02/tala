import { type Draft, readinessProblems, type Page, withPage } from './draft';

export interface DraftPort {
  exists(uri: string): Promise<boolean>;
  copyToPrivate(source: string, draftId: string, imageId: string): Promise<string>;
  remove(uri: string): Promise<void>;
  write(draft: Draft): Promise<void>;
}
export async function saveDraft(port: DraftPort, draft: Draft, now: string): Promise<Draft> {
  for (const page of Object.values(draft.pages)) {
    if (!page || !(await port.exists(page.uri))) throw new Error('An accepted image is missing. Retake that page before saving.');
  }
  if (draft.state === 'ready' && readinessProblems(draft).length) throw new Error('This draft is incomplete and cannot be marked ready.');
  const saved = { ...draft, updatedAt: now };
  await port.write(saved);
  return saved;
}
export async function acceptPage(port: DraftPort, draft: Draft, incoming: Page, now: string): Promise<Draft> {
  const uri = await port.copyToPrivate(incoming.uri, draft.id, incoming.imageId);
  const accepted = { ...incoming, uri };
  let saved: Draft;
  try { saved = await saveDraft(port, withPage(draft, accepted), now); }
  catch (e) { await port.remove(uri).catch(() => {}); throw e; }
  const previous = draft.pages[incoming.page];
  if (previous && previous.uri !== uri) await port.remove(previous.uri).catch(() => {});
  return saved;
}
