import { createHash } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { z } from 'zod';
import type { Actor } from './auth';
import { verifyActor } from './auth';
import { audit, transaction } from './db';
import { ApiError, requireCondition } from './errors';
import type { State, createSubmission, putFields, pageUpload, submissionQuery } from './contracts';
import { getTemplate, validateSnapshot } from './templates';
import { checksum, inspectImage, type ObjectStore } from './storage';

type Submission = {
  id: string; owner_id: string; client_submission_id: string; template_id: string; template_version: number;
  captured_at: Date; received_at: Date; completed_at: Date|null; updated_at: Date; status: State; revision: number;
  reviewer_id: string|null;
};
type Page = {
  page_number: number; image_id: string; object_key: string; mime_type: string;
  byte_size: number; width: number; height: number; sha256: string; uploaded_at: Date;
};
type Field = { field_key: string; page_number: number; source_image_id: string|null;
  ocr_original: string|null; ocr_confidence: number|null; ocr_metadata: Record<string,unknown>|null;
  mobile_value: string; mobile_confirmed: boolean; review_value: string|null; final_value: string|null };
type Result = { id: string; status: State; revision: number };
type Mutation = { statusCode: number; body: Result; replay: boolean };
export type ReviewAction = 'claim'|'correct'|'verify'|'return'|'reject'|'finalize';
type ReviewPayload = { notes?: string; fields?: { key: string; value: string }[] };

const visible = (actor: Actor, row: Submission) => actor.role === 'ENCODER' ? row.owner_id === actor.id :
  actor.role === 'VERIFIER' && row.completed_at !== null;
const mobileOpen = (row: Submission) => row.status === 'DRAFT' || row.status === 'UPLOADING';
const outcome = (row: Submission): Result => ({ id: row.id,status: row.status,revision: row.revision });
const summary = (row: Submission) => ({ ...outcome(row), clientSubmissionId: row.client_submission_id,
  templateId: row.template_id, templateVersion: row.template_version, capturedAt: row.captured_at,
  receivedAt: row.received_at, updatedAt: row.updated_at, completedAt: row.completed_at, reviewerId: row.reviewer_id });
const pageData = (row: Page) => ({ pageNumber: row.page_number,imageId: row.image_id,mimeType: row.mime_type,
  byteSize: row.byte_size,width: row.width,height: row.height,sha256: row.sha256,uploadedAt: row.uploaded_at,
  uploadStatus: 'COMPLETE' });
const fieldData = (row: Field) => ({ key: row.field_key,pageNumber: row.page_number,
  mobileValue: row.mobile_value,confirmed: row.mobile_confirmed,reviewValue: row.review_value,finalValue: row.final_value,
  ocr: row.ocr_original === null ? null : { ...row.ocr_metadata, original: row.ocr_original, imageId: row.source_image_id,confidence: row.ocr_confidence } });

function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.entries(value).sort(([a],[b])=>a.localeCompare(b))
    .map(([key,item])=>JSON.stringify(key)+':'+canonical(item)).join(',') + '}';
  return JSON.stringify(value);
}
const hashRequest = (operation: string, pathId: string|null, body: unknown) =>
  createHash('sha256').update(canonical([operation,pathId,body])).digest('hex');

async function lookup(db: Pool|PoolClient, actor: Actor, id: string, lock = false) {
  const row = (await db.query<Submission>('SELECT * FROM submissions WHERE id=$1'+(lock?' FOR UPDATE':''),[id])).rows[0];
  requireCondition(row && visible(actor,row),404,'NOT_FOUND','Submission not found.');
  return row;
}
async function pages(db: Pool|PoolClient, id: string) {
  return (await db.query<Page>('SELECT p.* FROM document_pages p JOIN template_pages t USING(template_id,template_version,page_number) WHERE submission_id=$1 ORDER BY t.display_order',[id])).rows;
}
async function fields(db: Pool|PoolClient, id: string) {
  return (await db.query<Field>('SELECT v.* FROM field_values v JOIN template_fields t USING(template_id,template_version,field_key,page_number) WHERE submission_id=$1 ORDER BY t.display_order',[id])).rows;
}
async function changeState(db: PoolClient, row: Submission, status: State, reviewer = row.reviewer_id) {
  return (await db.query<Submission>("UPDATE submissions SET status=$2::submission_state, reviewer_id=$3, revision=revision+1, updated_at=now(), completed_at=CASE WHEN $2::submission_state='PENDING_VERIFICATION' THEN now() ELSE completed_at END WHERE id=$1 RETURNING *",
    [row.id,status,reviewer])).rows[0];
}
export class Submissions {
  constructor(private pool: Pool, private storage: ObjectStore) {}

  private mutate(actor: Actor, key: string, operation: string, pathId: string|null, payload: unknown,
    run: (db: PoolClient) => Promise<{ row: Submission; statusCode: number }>): Promise<Mutation> {
    const requestHash = hashRequest(operation,pathId,payload);
    return transaction(this.pool,async db => {
      await verifyActor(db,actor);
      await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['request:'+actor.id+':'+key]);
      const prior = (await db.query('SELECT * FROM sync_operations WHERE actor_id=$1 AND idempotency_key=$2',[actor.id,key])).rows[0];
      if (prior) {
        requireCondition(prior.operation===operation && prior.request_sha256===requestHash,409,'IDEMPOTENCY_CONFLICT','This key was used for another request.');
        return { statusCode: prior.response_status,body: { id:prior.submission_id,revision:prior.response_revision,status:prior.response_state },replay:true };
      }
      const { row,statusCode } = await run(db);
      await db.query('INSERT INTO sync_operations(actor_id,idempotency_key,submission_id,operation,request_sha256,response_status,response_revision,response_state) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
        [actor.id,key,row.id,operation,requestHash,statusCode,row.revision,row.status]);
      return { statusCode,body: outcome(row),replay:false };
    });
  }

  create(actor: Actor, key: string, payload: z.infer<typeof createSubmission>) {
    return this.mutate(actor,key,'create',null,payload,async db => {
      await getTemplate(db,payload.templateId,payload.templateVersion);
      const inserted = (await db.query<Submission>(
        'INSERT INTO submissions(owner_id,client_submission_id,template_id,template_version,captured_at) VALUES ($1,$2,$3,$4,$5) ON CONFLICT(owner_id,client_submission_id) DO NOTHING RETURNING *',
        [actor.id,payload.clientSubmissionId,payload.templateId,payload.templateVersion,payload.capturedAt])).rows[0];
      if (inserted) {
        await audit(db,actor.id,'SUBMISSION_CREATED',inserted.id);
        return { row:inserted,statusCode:201 };
      }
      const row = (await db.query<Submission>('SELECT * FROM submissions WHERE owner_id=$1 AND client_submission_id=$2 FOR UPDATE',[actor.id,payload.clientSubmissionId])).rows[0];
      requireCondition(row.template_id === payload.templateId && row.template_version === payload.templateVersion &&
        row.captured_at.toISOString() === payload.capturedAt,409,'CLIENT_ID_CONFLICT','This client UUID already identifies another submission payload.');
      return { row,statusCode:200 };
    });
  }

  async upload(actor: Actor, key: string, id: string, payload: z.infer<typeof pageUpload>, upload: Buffer, mime: string) {
    // Check ownership before decoding potentially expensive input.
    await lookup(this.pool,actor,id);
    const image = await inspectImage(upload,mime,payload.checksum);
    return this.mutate(actor,key,'upload_page',id,{ ...payload,mime },async db => {
      const row = await lookup(db,actor,id,true);
      const page = (await db.query<Page>('SELECT * FROM document_pages WHERE submission_id=$1 AND page_number=$2',[id,payload.pageNumber])).rows[0];
      if (page) {
        requireCondition(page.image_id===payload.imageId && page.sha256===image.sha256 && page.mime_type===mime,
          409,'PAGE_CONFLICT','This page slot already contains another image.');
        return { row,statusCode:200 };
      }
      requireCondition(mobileOpen(row),409,'SUBMISSION_LOCKED','The submission no longer accepts uploads.');
      const slot = (await db.query('SELECT capture FROM template_pages WHERE template_id=$1 AND template_version=$2 AND page_number=$3',
        [row.template_id,row.template_version,payload.pageNumber])).rows[0];
      requireCondition(slot?.capture,422,'INVALID_PAGE_SLOT','This template does not accept an image for that page.');
      const duplicate = await db.query('SELECT 1 FROM document_pages WHERE submission_id=$1 AND image_id=$2',[id,payload.imageId]);
      requireCondition(!duplicate.rowCount,409,'IMAGE_ID_CONFLICT','Each page must have a distinct accepted image UUID.');
      await db.query('SELECT pg_advisory_xact_lock_shared(19381202)');
      try { await this.storage.put(image.objectKey,upload); }
      catch { throw new ApiError(503,'STORAGE_UNAVAILABLE','The image could not be stored. Retry this upload.'); }
      // Once written, a rollback or process crash may leave an orphan. Retention
      // removes only old unreferenced objects, including ambiguous commit cases.
      await db.query(
        'INSERT INTO document_pages(submission_id,template_id,template_version,page_number,image_id,object_key,mime_type,byte_size,width,height,sha256) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',
        [row.id,row.template_id,row.template_version,payload.pageNumber,payload.imageId,image.objectKey,mime,image.byteSize,image.width,image.height,image.sha256]);
      await audit(db,actor.id,'PAGE_UPLOADED',row.id,{ pageNumber:payload.pageNumber,bytes:image.byteSize });
      return {row:await changeState(db,row,'UPLOADING'),statusCode:201};
    });
  }

  putFields(actor: Actor,key: string,id: string,payload: z.infer<typeof putFields>) {
    const sorted = [...payload.fields].sort((a,b)=>a.key.localeCompare(b.key));
    return this.mutate(actor,key,'put_fields',id,sorted,async db => {
      const row = await lookup(db,actor,id,true);
      const existing = await fields(db,id);
      if (existing.length) {
        const sent = sorted.map(f => ({ ...f, ocr: f.ocr ? {...f.ocr,confidence:f.ocr.confidence??null} : null }));
        const saved = existing.map(fieldData).sort((a,b)=>a.key.localeCompare(b.key))
          .map(({key,mobileValue,confirmed,ocr})=>({key,mobileValue,confirmed,ocr}));
        requireCondition(canonical(sent)===canonical(saved),409,'FIELD_SNAPSHOT_CONFLICT','The mobile field snapshot already exists.');
        return {row,statusCode:200};
      }
      requireCondition(mobileOpen(row),409,'SUBMISSION_LOCKED','The submission no longer accepts field updates.');
      requireCondition(new Set(sorted.map(f=>f.key)).size===sorted.length,422,'DUPLICATE_FIELDS','Send each field key once.');
      const uploaded = await pages(db,id);
      validateSnapshot(row.template_id,row.template_version,Object.fromEntries(sorted.map(f=>[f.key,f.mobileValue])),uploaded.map(p=>p.page_number));
      const catalog = await getTemplate(db,row.template_id,row.template_version);
      const definitions = new Map(catalog.fields.map(f=>[f.id,f]));
      for (const field of sorted) {
        const definition = definitions.get(field.key);
        requireCondition(definition,422,'INVALID_FIELD','A field does not belong to this template.');
        const pageNumber = definition.page as number;
        const evidence = uploaded.find(p=>p.page_number===pageNumber);
        let ocrMetadata: Record<string,unknown>|null = null;
        if (field.ocr) {
          const { original,confidence,imageId,...metadata } = field.ocr;
          requireCondition(definition.mode==='ocr' && evidence?.image_id===imageId,422,'OCR_IMAGE_MISMATCH','OCR must reference the accepted image for its mapped field.');
          ocrMetadata = metadata;
        }
        await db.query(
          'INSERT INTO field_values(submission_id,template_id,template_version,field_key,page_number,source_image_id,ocr_original,ocr_confidence,ocr_metadata,mobile_value,mobile_confirmed) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',
          [id,row.template_id,row.template_version,field.key,pageNumber,field.ocr?.imageId??null,field.ocr?.original??null,field.ocr?.confidence??null,ocrMetadata,field.mobileValue,field.confirmed]);
      }
      await audit(db,actor.id,'MOBILE_FIELDS_RECEIVED',id,{ fieldCount:sorted.length });
      return {row:await changeState(db,row,'UPLOADING'),statusCode:200};
    });
  }
  complete(actor: Actor,key: string,id: string) {
    return this.mutate(actor,key,'complete',id,{},async db => {
      const row = await lookup(db,actor,id,true);
      if (row.completed_at) {
        const receipt = (await db.query<{response_revision:number;response_state:State}>(
          "SELECT response_revision,response_state FROM sync_operations WHERE submission_id=$1 AND operation='complete' ORDER BY response_revision LIMIT 1",[id])).rows[0];
        requireCondition(receipt,500,'INVALID_RECEIPT','The submission receipt could not be found.');
        return { row:{...row,revision:receipt.response_revision,status:receipt.response_state},statusCode:200 };
      }
      requireCondition(mobileOpen(row),409,'SUBMISSION_LOCKED','The submission is closed.');
      const uploaded = await pages(db,id);
      const template = await getTemplate(db,row.template_id,row.template_version);
      requireCondition(template.pages.filter(p=>p.required).every(p=>uploaded.some(file=>file.page_number===p.pageNumber)),
        409,'INCOMPLETE_PAGES','Upload all required pages before completing.');
      const saved = await fields(db,id);
      requireCondition(saved.length,409,'MISSING_FIELDS','Send a confirmed mobile field snapshot before completing.');
      validateSnapshot(row.template_id,row.template_version,Object.fromEntries(saved.map(f=>[f.field_key,f.mobile_value])),uploaded.map(p=>p.page_number));
      // Verify both metadata and availability at the point the queue becomes visible.
      for (const page of uploaded) await this.readVerifiedObject(page);
      const completed = await changeState(db,row,'PENDING_VERIFICATION');
      await audit(db,actor.id,'SUBMISSION_COMPLETED',id,{ pages:uploaded.length,revision:completed.revision });
      return {row:completed,statusCode:200};
    });
  }

  async review(actor: Actor,key: string,id: string,revision: number,action: ReviewAction,payload: ReviewPayload) {
    return this.mutate(actor,key,'review_'+action,id,{ revision,...payload },async db => {
      const row = await lookup(db,actor,id,true);
      requireCondition(row.revision===revision,412,'STALE_REVISION','Refresh the submission and retry against the current revision.');
      let next: State;
      if (action==='claim') {
        requireCondition(row.status==='PENDING_VERIFICATION',409,'INVALID_TRANSITION','Only a pending submission can be claimed.');
        next = 'IN_REVIEW';
      } else {
        requireCondition(row.reviewer_id===actor.id,403,'NOT_ASSIGNED','Only the assigned verifier can change this review.');
        if (action==='finalize') {
          requireCondition(row.status==='VERIFIED',409,'INVALID_TRANSITION','Verify the submission before finalizing.');
          next = 'FINALIZED';
        } else {
          requireCondition(row.status==='IN_REVIEW',409,'INVALID_TRANSITION','The submission is not in review.');
          next = action==='correct' ? 'IN_REVIEW' : action==='verify' ? 'VERIFIED' : action==='return' ? 'NEEDS_CORRECTION' : 'REJECTED';
        }
      }
      const saved = await fields(db,id);
      const values = Object.fromEntries(saved.map(f=>[f.field_key,f.review_value??f.mobile_value]));
      const changes = payload.fields ?? [];
      const available = await pages(db,id);
      if (action==='correct') {
        requireCondition(new Set(changes.map(f=>f.key)).size===changes.length,422,'DUPLICATE_FIELDS','Send each corrected field once.');
        for (const f of changes) {
          requireCondition(Object.hasOwn(values,f.key),422,'INVALID_FIELD','This field does not belong to the submitted snapshot.');
          values[f.key]=f.value;
        }
      }
      if (['correct','verify','finalize'].includes(action)) {
        validateSnapshot(row.template_id,row.template_version,values,available.map(p=>p.page_number));
      }
      if (action==='verify' || action==='finalize') for (const page of available) await this.readVerifiedObject(page);
      const updated = await changeState(db,row,next,actor.id);
      const event = (await db.query('INSERT INTO verification_records(submission_id,verifier_id,outcome,notes,revision) VALUES ($1,$2,$3,$4,$5) RETURNING id',
        [id,actor.id,action.toUpperCase(),payload.notes??null,updated.revision])).rows[0];
      for (const field of changes) {
        await db.query('UPDATE field_values SET review_value=$3 WHERE submission_id=$1 AND field_key=$2',[id,field.key,field.value]);
        await db.query('INSERT INTO verification_changes(verification_id,submission_id,field_key,value) VALUES ($1,$2,$3,$4)',
          [event.id,id,field.key,field.value]);
      }
      if (action==='finalize') await db.query('UPDATE field_values SET final_value=COALESCE(review_value,mobile_value) WHERE submission_id=$1',[id]);
      await audit(db,actor.id,'VERIFICATION_'+action.toUpperCase(),id,{ from:row.status,to:next,revision:updated.revision,fields:changes.map(c=>c.key) });
      return {row:updated,statusCode:200};
    });
  }
  async list(actor: Actor, query: z.infer<typeof submissionQuery>, db: Pool | PoolClient = this.pool) {
    const sort = query.sort === 'oldest' ? 's.received_at ASC,s.id ASC'
      : query.sort === 'status' ? 's.status ASC,s.received_at DESC,s.id DESC' : 's.received_at DESC,s.id DESC';
    const rows = await db.query<Submission & { owner_email: string; page_count: number }>(
      `SELECT s.*, u.email AS owner_email,
        (SELECT count(*)::int FROM document_pages p WHERE p.submission_id=s.id) AS page_count
       FROM submissions s JOIN users u ON u.id=s.owner_id
       JOIN document_templates t ON t.id=s.template_id AND t.version=s.template_version
       WHERE (CASE WHEN $1='ENCODER' THEN s.owner_id=$2::uuid ELSE s.completed_at IS NOT NULL END)
         AND ($3::submission_state IS NULL OR s.status=$3)
         AND ($6::text IS NULL OR position(lower($6) IN s.id::text)>0
              OR position(lower($6) IN lower(t.name))>0 OR position(lower($6) IN t.id)>0)
         AND ($7::text IS NULL OR s.template_id=$7)
         AND ($8::date IS NULL OR s.received_at>=($8::date::timestamp AT TIME ZONE 'UTC'))
         AND ($9::date IS NULL OR s.received_at<(($9::date+1)::timestamp AT TIME ZONE 'UTC'))
       ORDER BY ${sort} LIMIT $4 OFFSET $5`,
      [actor.role,actor.id,query.status??null,query.limit+1,query.offset,
        query.q??null,query.template??null,query.from??null,query.to??null]);
    const items = rows.rows.slice(0,query.limit).map(row=>({
      ...summary(row), pageCount:row.page_count,
      ...(actor.role==='VERIFIER' ? { submittedBy:{ id:row.owner_id,email:row.owner_email } } : {}),
    }));
    return { items, nextOffset: rows.rows.length>query.limit ? query.offset+query.limit : null };
  }
  async overview(actor: Actor) {
    return transaction(this.pool, async db => {
      await db.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const totals = await db.query<{status:State;count:string}>(
        'SELECT status,count(*) FROM submissions WHERE completed_at IS NOT NULL GROUP BY status');
      const { items: recent } = await this.list(actor,{ limit:6,offset:0 },db);
      return { total: totals.rows.reduce((sum,row)=>sum+Number(row.count),0),
        counts:Object.fromEntries(totals.rows.map(row=>[row.status,Number(row.count)])),recent };
    });
  }
  async details(actor: Actor,id: string,statusOnly = false) {
    return transaction(this.pool, async db => {
      await db.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const row = await lookup(db,actor,id);
      const files = (await pages(db,id)).map(pageData);
      const decision = (await db.query(
        "SELECT outcome,notes,created_at AS \"at\" FROM verification_records WHERE submission_id=$1 AND outcome IN ('RETURN','REJECT','VERIFY','FINALIZE') ORDER BY revision DESC LIMIT 1",[id])).rows[0] ?? null;
      const receipt = row.completed_at ? { submissionId: row.id, acknowledgedAt: row.completed_at } : null;
      const status = { ...summary(row), pages: files, receipt, decision };
      if (statusOnly) return status;
      return { ...status, fields: (await fields(db,id)).map(fieldData),
        ...(actor.role==='VERIFIER' ? { reviewHistory: (await db.query(
          'SELECT verifier_id AS "verifierId",outcome,notes,revision,created_at AS "at" FROM verification_records WHERE submission_id=$1 ORDER BY revision',[id])).rows } : {}) };
    });
  }
  async image(actor: Actor,id: string,pageNumber: number) {
    const row = await lookup(this.pool,actor,id);
    const page = (await this.pool.query<Page>('SELECT * FROM document_pages WHERE submission_id=$1 AND page_number=$2',[row.id,pageNumber])).rows[0];
    requireCondition(page,404,'NOT_FOUND','Uploaded page not found.');
    return { bytes: await this.readVerifiedObject(page),mime: page.mime_type };
  }
  private async readVerifiedObject(page: Page) {
    try {
      const bytes = await this.storage.read(page.object_key);
      if (bytes.length !== page.byte_size || checksum(bytes)!==page.sha256) throw new Error();
      return bytes;
    } catch { throw new ApiError(503,'IMAGE_UNAVAILABLE','The stored image is unavailable or failed its integrity check.'); }
  }
}
