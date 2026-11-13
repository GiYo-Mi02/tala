import { emptyValues, fieldKeys, type FieldKey, type Values, validateValues } from './fields';

export const TEST_PROFILE = 'fictional-local-profile-v1' as const;
export type PageNumber = 1 | 2;
export type Page = { page: PageNumber; uri: string; width: number; height: number; acceptedAt: string; imageId: string };
export type RawField = { text: string; crop: { x: number; y: number; width: number; height: number }; elements: { text: string; x: number; y: number; width: number; height: number }[] };
export type OcrRun = { id: string; pageImageId: string; at: string; engine: 'mlkit-bundled-latin-16.0.1'; fields: Record<FieldKey, RawField> };
export type Draft = {
  id: string; profileId: typeof TEST_PROFILE; templateId: 'beef-sy-2024-2025'; templateVersion: 1;
  createdAt: string; updatedAt: string; pages: Partial<Record<PageNumber, Page>>; values: Values;
  ocrHistory: OcrRun[]; confirmed: Partial<Record<FieldKey, boolean>>; state: 'editing' | 'ready';
};
export function newDraft(id: string, now: string): Draft {
  return { id, profileId: TEST_PROFILE, templateId: 'beef-sy-2024-2025', templateVersion: 1,
    createdAt: now, updatedAt: now, pages: {}, values: emptyValues(), ocrHistory: [], confirmed: {}, state: 'editing' };
}
export function readinessProblems(draft: Draft): string[] {
  const problems = Object.values(validateValues(draft.values));
  for (const n of [1, 2] as const) {
    if (!draft.pages[n] || draft.pages[n]?.page !== n) problems.push(`Accept page ${n}.`);
  }
  if (draft.profileId !== TEST_PROFILE || draft.templateId !== 'beef-sy-2024-2025' || draft.templateVersion !== 1) problems.push('Unsupported draft identity or template.');
  if (fieldKeys.some(k => !draft.confirmed[k])) problems.push('Review and confirm all seven fields, including optional blanks.');
  return problems;
}
export function withPage(draft: Draft, page: Page): Draft {
  return { ...draft, pages: { ...draft.pages, [page.page]: page }, state: 'editing',
    confirmed: page.page === 1 ? {} : draft.confirmed };
}
