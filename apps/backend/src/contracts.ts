import { z } from 'zod';

export const roles = z.enum(['ENCODER','VERIFIER','ADMIN']);
export const states = z.enum(['DRAFT','UPLOADING','PENDING_VERIFICATION','IN_REVIEW',
  'NEEDS_CORRECTION','VERIFIED','REJECTED','FINALIZED','EXPIRED']);
export type Role = z.infer<typeof roles>;
export type State = z.infer<typeof states>;
export const id = z.uuidv4();
export const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
export const number = z.coerce.number().int().min(1).max(50);
export const fieldKey = z.string().regex(/^[a-z][a-z0-9_]{0,95}$/);
export const password = z.string().min(12).max(128);
export const email = z.email().max(254).transform(s => s.toLowerCase());
export const login = z.strictObject({ email, password: z.string().min(1).max(128), mode: z.enum(['native','browser']).default('native') });
export const refresh = z.strictObject({ refreshToken: z.string().regex(/^[A-Za-z0-9_-]{43}$/).optional() });
export const userCreate = z.strictObject({ email, password, role: roles });
export const userUpdate = z.strictObject({ active: z.boolean() });
export const createSubmission = z.strictObject({ clientSubmissionId: id,
  templateId: z.string().regex(/^[a-z0-9-]{1,100}$/), templateVersion: z.number().int().positive().max(2147483647),
  capturedAt: z.iso.datetime({ offset: true }).transform(s => new Date(s).toISOString()),
});
export const normalizedRect = z.strictObject({ x: z.number().min(0).max(1), y: z.number().min(0).max(1),
  width: z.number().positive().max(1), height: z.number().positive().max(1) })
  .refine(r => r.x+r.width <= 1.0000001 && r.y+r.height <= 1.0000001, 'Bounding box must lie inside the image.');
export const ocr = z.strictObject({ imageId: id, original: z.string().max(4000),
  runId: id.optional(), engine: z.string().min(1).max(100).optional(), confidence: z.number().min(0).max(1).nullable().optional(),
  regions: z.array(normalizedRect).max(40).optional(), warning: z.string().max(250).optional(),
});
export const mobileField = z.strictObject({ key: fieldKey, mobileValue: z.string().max(500), confirmed: z.literal(true), ocr: ocr.nullable() });
export const putFields = z.strictObject({ fields: z.array(mobileField).min(1).max(300) });
export const pageUpload = z.strictObject({ pageNumber: number, imageId: id, checksum: sha256 });
export const pageQuery = z.strictObject({ limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).max(10000).default(0), status: states.optional() });
const receivedDate=z.iso.date().refine(value=>!value.startsWith('0000-'));
export const submissionQuery = pageQuery.extend({
  offset: z.coerce.number().int().min(0).max(2147483547).default(0),
  q: z.string().trim().min(1).max(100).optional(),
  template: createSubmission.shape.templateId.optional(),
  from: receivedDate.optional(),
  to: receivedDate.optional(),
  sort: z.enum(['newest','oldest','status']).optional(),
}).refine(q => !q.from || !q.to || q.from <= q.to, { path: ['to'] });
export const correction = z.strictObject({ fields: z.array(z.strictObject({ key: fieldKey, value: z.string().max(500) })).min(1).max(300),
  notes: z.string().trim().max(1500).optional() });
export const reviewNotes = z.strictObject({ notes: z.string().trim().max(1500).optional() });
export const reason = z.strictObject({ notes: z.string().trim().min(1).max(1500) });
export const empty = z.strictObject({});
