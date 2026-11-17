import sss from './sss-e1.json';
import { TEST_PROFILE } from './draft';
import { validIsoDate } from './fields';
import type { Alignment } from './alignment';
import type { Region } from './template';

export type FixedField = {
  id: string; label: string; section: string; page: number;
  type: 'text' | 'name' | 'identifier' | 'date' | 'choice' | 'phone' | 'email' | 'year' | 'amount';
  mode: 'ocr' | 'manual'; required: boolean; requiredValue?: string; options?: string[]; digits?: number[];
  cells?: number; grid?: boolean; region?: Region; reviewRegion?: Region; points?: number[]; row?: string | null;
  when?: { field: string; values: string[] };
};
export type FixedTemplate = { id: string; version: number; label: string; revision: string; sourceSha256: string;
  pages: { number: number; label: string; capture: boolean; required: boolean; width: number; height: number }[]; fields: FixedField[] };
export const sssTemplate = sss as FixedTemplate;
export const fixedTemplates: readonly FixedTemplate[] = [sssTemplate];
export function fixedTemplate(id: string, version: number): FixedTemplate {
  const match = fixedTemplates.find(t => t.id === id && t.version === version);
  if (!match) throw new Error('Unsupported template version. The original draft is retained.');
  return match;
}
export type FixedPage = { page: number; imageId: string; uri: string; width: number; height: number; acceptedAt: string; alignment: Alignment };
export type FixedReading = { fieldId: string; pageImageId: string; text: string; originalText: string; processedText: string;
  originalNormalized: string; processedNormalized: string; segmentedText?: string; segmentedNormalized?: string; normalized: string; confidence: number | null;
  warning?: string; region: Region; error?: string };
export type FixedRun = { id: string; pageImageId: string; page: number; at: string; templateId: string; templateVersion: number;
  engine: 'mlkit-bundled-latin-16.0.1'; preprocessing: 'native-roi-v3'; fields: Record<string, FixedReading> };
export type FixedDraft = { kind: 'fixed-template-draft-v1'; id: string; profileId: typeof TEST_PROFILE; templateId: string; templateVersion: number;
  createdAt: string; updatedAt: string; pages: Record<number, FixedPage | undefined>; values: Record<string,string>;
  confirmed: Record<string,boolean>; history: FixedRun[]; state: 'editing' | 'ready' };
export function newFixedDraft(id: string, now: string, template = sssTemplate): FixedDraft {
  return { kind: 'fixed-template-draft-v1', id, profileId: TEST_PROFILE, templateId: template.id, templateVersion: template.version,
    createdAt: now, updatedAt: now, pages: {}, values: Object.fromEntries(template.fields.map(f => [f.id,''])), confirmed: {}, history: [], state: 'editing' };
}
export function activeFixedFields(draft: FixedDraft): FixedField[] {
  return fixedTemplate(draft.templateId,draft.templateVersion).fields.filter(f =>
    (f.page !== 3 || draft.values.sss_additional_sheet_used === 'Yes') &&
    (!f.when || f.when.values.includes(draft.values[f.when.field])));
}
export function normalizeFixed(field: FixedField, raw: string): string {
  const text = field.type === 'name' ? raw.trim() : raw.trim().replace(/\s+/g,' ');
  if (field.type === 'date') {
    const compact = text.replace(/\s/g,'');
    const match = /^(\d{2})\/?(\d{2})\/?(\d{4})$/.exec(compact);
    return match ? `${match[3]}-${match[1]}-${match[2]}` : text;
  }
  if (field.type === 'identifier') return text.replace(/[\s-]/g,'');
  if (field.type === 'name') return text.toUpperCase();
  if (field.type === 'amount') return /^\d{1,3}(,\d{3})+(\.\d{1,2})?$/.test(text) ? text.replaceAll(',','') : text;
  return text;
}
export function fixedFieldError(field: FixedField, value: string): string | undefined {
  if (!value.trim()) return field.required ? 'Required for this local review.' : undefined;
  if (value.length > 500) return 'Use at most 500 characters.';
  if (field.requiredValue && value !== field.requiredValue) return 'Review this area on the source image before marking ready.';
  if (field.type === 'choice' && !field.options?.includes(value)) return 'Choose an option after checking the original box.';
  if (field.type === 'name' && (!/^[\p{L}\p{M} .’'\-]+$/u.test(value) || !/\p{L}/u.test(value))) return 'Review name: unexpected digits or symbols.';
  if (field.type === 'date' && !validIsoDate(value)) return 'Enter a real date in MMDDYYYY or MM/DD/YYYY order.';
  if (field.type === 'identifier' && field.digits && !field.digits.some(n => new RegExp(`^\\d{${n}}$`).test(value)))
    return `Use ${field.digits.join(' or ')} digits; keep leading zeros. Do not guess uncertain characters.`;
  if (field.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return 'Review the email address.';
  if (field.type === 'phone' && !/^\+?[0-9 ()\-]{5,35}$/.test(value)) return 'Review the telephone number and any country/area code.';
  if (field.type === 'year' && !/^\d{4}$/.test(value)) return 'Use a four-digit year.';
  if (field.type === 'amount' && !/^\d+(\.\d{1,2})?$/.test(value)) return 'Use a non-negative amount with up to two decimal places.';
}
export function fixedErrors(draft: FixedDraft): Record<string,string> {
  const fields = activeFixedFields(draft); const errors: Record<string,string> = {};
  for (const f of fields) { const error = fixedFieldError(f, draft.values[f.id] ?? ''); if (error) errors[f.id] = error; }
  // Empty dependent rows are allowed. Partially completed rows cannot masquerade as complete.
  for (const row of new Set(fields.map(f => f.row).filter(Boolean))) {
    const members = fields.filter(f => f.row === row);
    if (!members.some(f => draft.values[f.id]?.trim())) continue;
    for (const f of members.filter(f => /_(last_name|first_name|birth_date|relationship)$/.test(f.id)))
      if (!draft.values[f.id]?.trim()) errors[f.id] = 'Complete this populated dependent/beneficiary row or clear it after checking the source.';
  }
  // Repeated applicant identifiers are compared, never copied into an empty field.
  if (draft.values.sss_additional_sheet_used === 'Yes') {
    for (const part of ['last_name','first_name','middle_name','suffix']) {
      const left=draft.values[`sss_registrant_${part}`]; const right=draft.values[`sss_additional_registrant_${part}`];
      if (left && right && left !== right) errors[`sss_additional_registrant_${part}`]='This differs from the main page. Compare both originals; no identity value was changed.';
    }
    const a=draft.values.sss_ss_number,b=draft.values.sss_additional_ss_number;
    if(a && b && a!==b)errors.sss_additional_ss_number='SS numbers differ between pages. Check both originals.';
  }
  return errors;
}
export function fixedReadiness(draft: FixedDraft): string[] {
  const template = fixedTemplate(draft.templateId,draft.templateVersion);
  const result = Object.values(fixedErrors(draft));
  if (draft.profileId !== TEST_PROFILE || draft.kind !== 'fixed-template-draft-v1') result.push('Unsupported draft identity.');
  for (const p of template.pages.filter(p => p.capture && (p.required || p.number === 3 && draft.values.sss_additional_sheet_used === 'Yes')))
    if (!draft.pages[p.number]) result.push(`Accept ${p.label}.`);
  if (activeFixedFields(draft).some(f => !draft.confirmed[f.id])) result.push('Check and confirm every active field, including manual boxes and optional blanks.');
  return result;
}
export function fixedWithPage(draft: FixedDraft, page: FixedPage, run: FixedRun | undefined, replace: boolean): FixedDraft {
  const template=fixedTemplate(draft.templateId,draft.templateVersion);
  if (!template.pages.some(p => p.capture && p.number===page.page)) throw new Error('This is a reference-only or unsupported page slot.');
  if (run && (run.pageImageId!==page.imageId || run.page!==page.page || run.templateId!==draft.templateId || run.templateVersion!==draft.templateVersion)) throw new Error('OCR and image/template identity mismatch.');
  const keys=template.fields.filter(f=>f.page===page.page).map(f=>f.id);
  if(run && Object.keys(run.fields).some(key=>!keys.includes(key) || run.fields[key].fieldId!==key || run.fields[key].pageImageId!==page.imageId)) throw new Error('Field identity does not match this template page.');
  return { ...draft, pages:{...draft.pages,[page.page]:page}, history:run?[...draft.history,run]:draft.history,
    values:replace && run ? {...draft.values,...Object.fromEntries(Object.entries(run.fields).map(([key,r])=>[key,r.normalized]))}:draft.values,
    confirmed:{...draft.confirmed,...Object.fromEntries(keys.map(key=>[key,false]))},state:'editing' };
}

export interface FixedPort { exists(uri:string):Promise<boolean>; copy(source:string,draftId:string,imageId:string):Promise<string>;
  remove(uri:string):Promise<void>; write(draft:FixedDraft):Promise<void> }
export async function saveFixed(port:FixedPort,draft:FixedDraft,now:string):Promise<FixedDraft> {
  fixedTemplate(draft.templateId,draft.templateVersion);
  if(draft.profileId!==TEST_PROFILE || draft.kind!=='fixed-template-draft-v1')throw new Error('Draft profile mismatch.');
  for(const page of Object.values(draft.pages))if(page && !(await port.exists(page.uri)))throw new Error('An accepted image is missing. Retake that page before saving.');
  if(draft.state==='ready' && fixedReadiness(draft).length)throw new Error('This draft is incomplete and cannot be marked ready.');
  const next={...draft,updatedAt:now}; await port.write(next); return next;
}
export async function acceptFixedPage(port:FixedPort,draft:FixedDraft,incoming:FixedPage,run:FixedRun|undefined,replace:boolean,now:string):Promise<FixedDraft> {
  const staged=fixedWithPage(draft,incoming,run,replace);
  const uri=await port.copy(incoming.uri,draft.id,incoming.imageId);
  let saved:FixedDraft;
  try { saved=await saveFixed(port,{...staged,pages:{...staged.pages,[incoming.page]:{...incoming,uri}}},now); }
  catch(error) { await port.remove(uri).catch(()=>{});throw error; }
  const old=draft.pages[incoming.page];if(old && old.uri!==uri)await port.remove(old.uri).catch(()=>{});
  return saved;
}
