import type { Pool, PoolClient } from 'pg';
import { beefTemplate, fieldKeys, fieldLabels, valuesSchema, sssTemplate, newFixedDraft, activeFixedFields, fixedErrors } from '@tala/core';
import { ApiError } from './errors';
import { transaction } from './db';

const beefFields = fieldKeys.map((key, index) => ({
  id: key, label: fieldLabels[key], page: 1, displayOrder: index+1,
  type: key === 'lrn' ? 'identifier' : key === 'birth_date' ? 'date' : key === 'school_year' ? 'school_year' : key === 'grade_level' ? 'grade' : 'name',
  required: key !== 'lrn' && key !== 'learner_middle_name', mode: 'ocr',
  regions: beefTemplate.regions[key], cells: beefTemplate.cells[key],
  ...(key === 'lrn' ? { digits: [12] } : key === 'grade_level' ? { minimum: 1, maximum: 12 } : {}),
}));
const definitions = [{
  id: beefTemplate.id, version: beefTemplate.version, name: beefTemplate.label, metadata: { note: beefTemplate.pilotNotice },
  pages: beefTemplate.pages.map(p => ({ number: p.page, required: true, capture: true, label: 'Page '+p.page })),
  fields: beefFields,
},{
  id: sssTemplate.id, version: sssTemplate.version, name: sssTemplate.label,
  metadata: { revision: sssTemplate.revision, sourceSha256: sssTemplate.sourceSha256,
    additionalPage: { number: 3, when: { field: 'sss_additional_sheet_used', equals: 'Yes' } } },
  pages: sssTemplate.pages, fields: sssTemplate.fields.map((f, index) => ({ ...f, displayOrder: index+1 })),
}];

export async function seedTemplates(pool: Pool) {
  await transaction(pool, async db => {
    for (const t of definitions) {
      await db.query('INSERT INTO document_templates(id,version,name,metadata) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING',
        [t.id,t.version,t.name,t.metadata]);
      for (const [index,p] of t.pages.entries())
        await db.query('INSERT INTO template_pages(template_id,template_version,page_number,display_order,capture,required,label) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING',
          [t.id,t.version,p.number,index+1,p.capture,p.required,p.label]);
      for (const f of t.fields)
        await db.query('INSERT INTO template_fields(template_id,template_version,field_key,page_number,label,data_type,display_order,rules) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING',
          [t.id,t.version,f.id,f.page,f.label,f.type,f.displayOrder,f]);
    }
  });
}
export async function getTemplate(db: Pool | PoolClient, id: string, version: number) {
  const template = (await db.query<{id:string;version:number;name:string;metadata:Record<string,unknown>}>(
    'SELECT id,version,name,metadata FROM document_templates WHERE id=$1 AND version=$2',[id,version])).rows[0];
  if (!template) throw new ApiError(404,'TEMPLATE_NOT_FOUND','The requested template version is unavailable.');
  const pages = (await db.query<{pageNumber:number;order:number;required:boolean;capture:boolean;label:string}>(
    'SELECT page_number AS "pageNumber", display_order AS "order", required,capture,label FROM template_pages WHERE template_id=$1 AND template_version=$2 ORDER BY display_order',[id,version])).rows;
  const fields = (await db.query<{rules: Record<string, unknown>}>('SELECT rules FROM template_fields WHERE template_id=$1 AND template_version=$2 ORDER BY display_order',[id,version])).rows.map(({rules})=>
    id===beefTemplate.id && version===beefTemplate.version
      ? { ...rules, section:['school_year','grade_level','lrn'].includes(String(rules.id)) ? 'Enrollment information' : 'Learner information' }
      : rules);
  return { ...template, pages, fields };
}

export function validateSnapshot(templateId: string, version: number, values: Record<string,string>, pageNumbers: number[]) {
  const fields: string[] = [];
  let expectedPages: number[];
  if (templateId === beefTemplate.id && version === beefTemplate.version) {
    const check = valuesSchema.safeParse(values);
    if (!check.success) fields.push(...check.error.issues.flatMap(i=>i.path.length ? i.path.map(String) : ['fields']));
    expectedPages = [1,2];
  } else if (templateId === sssTemplate.id && version === sssTemplate.version) {
    const draft = { ...newFixedDraft('validate',''), values };
    const active = new Set(activeFixedFields(draft).map(f=>f.id));
    for (const key of active) if (!Object.hasOwn(values,key)) fields.push(key);
    for (const key of Object.keys(values)) if (!active.has(key)) fields.push(key);
    fields.push(...Object.keys(fixedErrors(draft)));
    expectedPages = values.sss_additional_sheet_used === 'Yes' ? [1,3] : [1];
  } else throw new ApiError(422,'UNSUPPORTED_TEMPLATE','This template version has no validation rules.');
  if (fields.length) throw new ApiError(422,'INVALID_FIELDS','Confirm and validate every active field.', [...new Set(fields)].sort());
  if (expectedPages.length !== pageNumbers.length || expectedPages.some(n=>!pageNumbers.includes(n)))
    throw new ApiError(409,'INCOMPLETE_PAGES','The uploaded page slots must match the applicable template pages.');
}
