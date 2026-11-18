import { z } from 'zod';
import * as request from './contracts';

const shape = (schema: z.ZodType) => {
  const { $schema, ...result } = z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' });
  return result;
};
const str = z.string();
const int = z.number().int();
const date = z.iso.datetime();
const json = (schema: object) => ({ 'application/json': { schema } });
const response = (description: string, schema?: z.ZodType, headers?: object) =>
  ({ description, ...(schema ? { content: json(modelRef(schema)) } : {}), ...(headers ? { headers } : {}) });
const body = (schema: z.ZodType, required = true) => ({ required, content: json(shape(schema)) });
const account = z.object({ id: request.id, email: z.email(), role: request.roles });
const accountStatus = account.extend({ active: z.boolean() });
const pair = z.object({ accessToken: str, refreshToken: str.optional(), tokenType: z.literal('Bearer'), expiresIn: int });
const result = z.object({ id: request.id, status: request.states, revision: int });
const summary = result.extend({
  clientSubmissionId: request.id, templateId: str, templateVersion: int, capturedAt: date, receivedAt: date,
  updatedAt: date, completedAt: date.nullable(), reviewerId: request.id.nullable(),
});
const page = z.object({ pageNumber: int, imageId: request.id, mimeType: z.enum(['image/jpeg', 'image/png']),
  sha256: request.sha256, width: int, height: int, byteSize: int, uploadedAt: date, uploadStatus: z.literal('COMPLETE') });
const notes = z.object({ notes: str.nullable(), at: date });
const decision = notes.extend({ outcome: z.enum(['RETURN', 'REJECT', 'VERIFY', 'FINALIZE']) });
const status = summary.extend({ pages: z.array(page), decision: decision.nullable(),
  receipt: z.object({ submissionId: request.id, acknowledgedAt: date }).nullable() });
const field = request.mobileField.extend({ pageNumber: int, reviewValue: str.nullable(), finalValue: str.nullable() });
const detail = status.extend({ fields: z.array(field), reviewHistory: z.array(notes.extend({ verifierId: request.id,
  outcome: z.enum(['CLAIM', 'CORRECT', 'VERIFY', 'RETURN', 'REJECT', 'FINALIZE']), revision: int })).optional() });
const listItem = summary.extend({ pageCount: int.nonnegative(), submittedBy: account.pick({id:true,email:true}).optional() });
const list = z.object({ items: z.array(listItem), nextOffset: int.nullable() });
const overview = z.object({ total:int.nonnegative(), counts:z.partialRecord(request.states,int.nonnegative()), recent:z.array(listItem) });
const template = z.object({ id: str, version: int, name: str, metadata: z.record(str, z.unknown()) });
const templateDetail = template.extend({
  pages: z.array(z.object({ pageNumber: int, order: int, required: z.boolean(), capture: z.boolean(), label: str })),
  fields: z.array(z.looseObject({ id: str, label: str, page: int, displayOrder: int, type: str, required: z.boolean(), mode: str, section:str.optional() })),
});
const envelope = z.object({ error: z.object({ code: str, message: str, requestId: request.id, fields: z.array(str).optional() }) });
const models = { Account: account, AccountStatus: accountStatus, Session: pair, Mutation: result,
  SubmissionStatus: status, SubmissionDetail: detail, SubmissionList: list, SubmissionOverview:overview,
  TemplateVersion: templateDetail, ErrorEnvelope: envelope };
const modelNames = new Map<z.ZodType, string>(Object.entries(models).map(([name, schema]) => [schema, name]));
function modelRef(schema: z.ZodType) {
  const name = modelNames.get(schema);
  return name ? { $ref: '#/components/schemas/'+name } : shape(schema);
}
const problem = (codes: string) => ({
  description: codes.split(' ').join(', '),
  content: json(modelRef(envelope)),
  'x-error-codes': codes.split(' '),
});
const bearer = [{ bearerAuth: [] }];
const refreshSecurity = [{ refreshCookie: [] }, {}];
const etag = { ETag: { description: 'Quoted submission revision', schema: { type: 'string', example: '"3"' } } };
const mutationHeaders = { ...etag, 'Idempotency-Replayed': { description: 'Present for a replayed operation key', schema: { type: 'string', enum: ['true'] } } };
const cookies = { 'Set-Cookie': { description: 'HTTPS browser refresh cookie when using browser mode',
  schema: { type: 'string' } } };
const parameter = (name: string, location: 'path' | 'header' | 'query', schema: object, description: string) =>
  ({ name, in: location, required: location !== 'query', schema, description });
const key = parameter('Idempotency-Key', 'header', shape(request.id), 'Persist one distinct UUIDv4 per logical operation');
const match = parameter('If-Match', 'header', { type: 'string', pattern: '^"[1-9][0-9]{0,9}"$' }, 'ETag from the last submission read');
const id = parameter('id', 'path', shape(request.id), 'Server-issued record UUIDv4');
const pageNumber = parameter('pageNumber', 'path', { type: 'integer', minimum: 1, maximum: 50 }, 'Template page slot');
const query = (queue = false) => [
  parameter('limit', 'query', { type: 'integer', minimum: 1, maximum: 100, default: 25 }, 'Page size'),
  parameter('offset', 'query', { type: 'integer', minimum: 0, maximum: queue ? 10000 : 2147483547, default: 0 }, 'Continue with nextOffset'),
  parameter('status', 'query', queue ? { type: 'string', enum: ['PENDING_VERIFICATION', 'IN_REVIEW'], default: 'PENDING_VERIFICATION' }
    : shape(request.states), 'Optional server status filter'),
];
const browseQuery = [...query(),
  parameter('q','query',{type:'string',minLength:1,maxLength:100},'Literal search of server reference or template ID/name only'),
  parameter('template','query',shape(request.createSubmission.shape.templateId),'Exact template ID'),
  parameter('from','query',{type:'string',format:'date'},'First received UTC calendar day, inclusive'),
  parameter('to','query',{type:'string',format:'date'},'Last received UTC calendar day, inclusive'),
  parameter('sort','query',{type:'string',enum:['newest','oldest','status']},'Sort by received time or server status'),
];
const image = { schema: { type: 'string', format: 'binary' } };
const imageContent = { 'image/jpeg': image, 'image/png': image };
const authFailure = 'AUTH_REQUIRED';
const denied = 'FORBIDDEN';
const locked = 'SUBMISSION_LOCKED';
const mismatch = 'IDEMPOTENCY_CONFLICT';
const missing = 'NOT_FOUND';
const invalid = 'INVALID_REQUEST';
const retry = 'DATABASE_UNAVAILABLE';

type Operation = {
  summary: string;
  parameters?: object[];
  requestBody?: object;
  security?: object[];
  responses: Record<number, object>;
};
function op(operationId: string, definition: Operation, codes: Record<string, string | undefined> = {}) {
  return { operationId, ...definition, security: definition.security ?? bearer, responses: {
    500: problem('INTERNAL_ERROR'),
    ...definition.responses, ...Object.fromEntries(Object.entries(codes).flatMap(([code, entries]) => entries ? [[code, problem(entries)]] : [])),
    429: { ...problem('RATE_LIMITED'), headers: { 'Retry-After': { schema: { type: 'integer' } } } },
  } };
}
const invalidBody = { 400: invalid+' HTTPS_REQUIRED', 413: 'TOO_LARGE', 415: 'UNSUPPORTED_MEDIA' };
const signedIn = { 401: authFailure, 503: retry };
const general = { 400: invalid+' HTTPS_REQUIRED', ...signedIn };
const reader = { ...general, 403: denied, 404: missing };
const writer = { ...reader, 409: mismatch+' '+locked };
const updated = { 200: response('Operation committed', result, mutationHeaders) };
const accepted = { ...updated, 201: response('Resource created', result, mutationHeaders) };
const browser = { 403: 'BROWSER_ORIGIN_REQUIRED' };
const sessionInput = { ...invalidBody, ...browser, 503: retry };
const refreshErrors = { ...sessionInput, 400: invalidBody[400]+' AMBIGUOUS_CREDENTIAL' };

const review = {
  claim: { contract: request.empty, description: 'Claim a pending submission as a verifier', invalid: '' },
  correct: { contract: request.correction, description: 'Correct fields on your claimed submission', invalid: 'INVALID_FIELD INVALID_FIELDS DUPLICATE_FIELDS' },
  verify: { contract: request.reviewNotes, description: 'Verify your claimed submission', invalid: 'INVALID_FIELDS' },
  return: { contract: request.reason, description: 'Return your claimed submission and record the reason', invalid: '' },
  reject: { contract: request.reason, description: 'Reject your claimed submission and record the reason', invalid: '' },
  finalize: { contract: request.reviewNotes, description: 'Finalize your verified submission and freeze final values', invalid: 'INVALID_FIELDS' },
};
const reviewPaths = Object.fromEntries(Object.entries(review).map(([action, def]) => [
  '/submissions/{id}/review/'+action, { post: op(action+'Submission', {
    summary: def.description, parameters: [id, key, match], requestBody: body(def.contract, action==='correct'||action==='return'||action==='reject'),
    responses: updated,
  }, { ...reader, ...invalidBody, 400: invalidBody[400]+' INVALID_REVISION', 403: denied+' NOT_ASSIGNED',
    409: mismatch+' INVALID_TRANSITION', 412: 'STALE_REVISION', 428: 'REVISION_REQUIRED',
    503: ['verify','finalize'].includes(action) ? retry+' IMAGE_UNAVAILABLE' : retry,
    ...(def.invalid ? { 422: def.invalid+' UNSUPPORTED_TEMPLATE', 409: mismatch+' INVALID_TRANSITION INCOMPLETE_PAGES' } : {}) }) },
]));

export const spec = {
  openapi: '3.1.0',
  info: { title: 'T.A.L.A. Phase 2.1 API', version: '1.0.0',
    description: 'PostgreSQL-backed intake and verification for BEEF and SSS E-1. Use HTTPS outside loopback development. Record and image reads require an encoder owner or verifier access.' },
  servers: [{ url: '/api/v1' }],
  components: { schemas: Object.fromEntries(Object.entries(models).map(([name, schema])=>[name, shape(schema)])), securitySchemes: {
    bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'Opaque access token' },
    refreshCookie: { type: 'apiKey', in: 'cookie', name: '__Secure-tala-refresh',
      description: 'HTTPS and an allowlisted Origin required for cookie-based auth requests' },
  } },
  paths: {
    '/health': { get: op('getHealth', { summary: 'Check database connectivity', security: [],
      responses: { 200: response('Database reachable', z.object({ status: z.literal('ok') })) } },
      { 400: 'HTTPS_REQUIRED', 503: retry }) },
    '/auth/login': { post: op('login', { summary: 'Sign in as a provisioned user', security: [], requestBody: body(request.login),
      responses: { 200: response('Native token pair or browser access token and refresh cookie', pair, cookies) } },
      { ...sessionInput, 401: 'INVALID_CREDENTIALS' }) },
    '/auth/refresh': { post: op('refresh', { summary: 'Rotate an eligible refresh credential',
      security: refreshSecurity, requestBody: body(request.refresh, false),
      responses: { 200: response('Rotated token pair or access token and refresh cookie', pair, cookies) } },
      { ...refreshErrors, 401: 'AUTH_REQUIRED INVALID_REFRESH' }) },
    '/auth/logout': { post: op('logout', { summary: 'Revoke the session using its refresh credential',
      security: refreshSecurity, requestBody: body(request.refresh, false), responses: { 204: response('Session revoked', undefined, cookies) } },
      { ...refreshErrors, 401: authFailure }) },
    '/auth/me': { get: op('getAccount', { summary: 'Get the authenticated user', responses: { 200: response('Account', account) } }, general) },
    '/admin/users': { post: op('provisionAccount', { summary: 'Provision a user as an administrator',
      requestBody: body(request.userCreate), responses: { 201: response('Account created', accountStatus) } },
      { ...signedIn, ...invalidBody, 403: denied, 409: 'EMAIL_EXISTS' }) },
    '/admin/users/{id}': { patch: op('changeAccount', { summary: 'Change account activation as an administrator',
      parameters: [id], requestBody: body(request.userUpdate), responses: { 200: response('Account updated', accountStatus) } },
      { ...reader, ...invalidBody, 422: 'SELF_CHANGE' }) },
    '/templates': { get: op('listTemplates', { summary: 'List versioned templates',
      responses: { 200: response('Template versions', z.object({ items: z.array(template) })) } }, general) },
    '/templates/{id}/versions/{version}': { get: op('getTemplateVersion', { summary: 'Get the page slots and field mapping',
      parameters: [parameter('id', 'path', shape(request.createSubmission.shape.templateId), 'Template identifier'),
        parameter('version', 'path', { type: 'integer', minimum: 1, maximum: 2147483647 }, 'Pinned version')],
      responses: { 200: response('Template definition', templateDetail) } }, { ...general, 404: 'TEMPLATE_NOT_FOUND' }) },
    '/submissions': {
      post: op('createSubmission', { summary: 'Create or resume an encoder submission', parameters: [key],
        requestBody: body(request.createSubmission), responses: accepted },
      { ...writer, ...invalidBody, 404: 'TEMPLATE_NOT_FOUND', 409: mismatch+' CLIENT_ID_CONFLICT' }),
      get: op('listSubmissions', { summary: 'List visible submissions', parameters: browseQuery,
        responses: { 200: response('Submissions', list) } }, { ...general, 403: denied }),
    },
    '/submissions/overview': { get: op('getSubmissionOverview', {
      summary: 'Summarize completed submissions for a verifier, using one database snapshot',
      responses: { 200: response('Total, sparse counts by status and up to six recent records', overview) },
    }, { ...general, 403: denied }) },
    '/submissions/{id}': { get: op('getSubmission', { summary: 'Get submission details and the verifier history when permitted',
      parameters: [id], responses: { 200: response('Submission detail', detail, etag) } }, reader) },
    '/submissions/{id}/status': { get: op('getSubmissionStatus', { summary: 'Recover upload progress and acknowledgment',
      parameters: [id], responses: { 200: response('Current status and receipt', status, etag) } }, reader) },
    '/submissions/{id}/pages/{pageNumber}': {
      put: op('uploadPage', { summary: 'Upload or replay one immutable page slot as the owner',
        parameters: [id, pageNumber, key, parameter('X-Image-Id', 'header', shape(request.id), 'Accepted local image UUIDv4'),
          parameter('X-Content-SHA256', 'header', shape(request.sha256), 'Lowercase SHA-256 of the binary bytes')],
        requestBody: { required: true, content: imageContent }, responses: accepted },
      { ...writer, ...invalidBody, 400: invalidBody[400]+' EMPTY_UPLOAD', 409: writer[409]+' PAGE_CONFLICT IMAGE_ID_CONFLICT',
        415: 'UNSUPPORTED_MEDIA INVALID_IMAGE', 422: 'INVALID_PAGE_SLOT CHECKSUM_MISMATCH', 503: retry+' STORAGE_UNAVAILABLE' }),
      get: op('downloadPage', { summary: 'Read one private authorized page', parameters: [id, pageNumber],
        responses: { 200: { description: 'Verified image bytes', content: imageContent } } },
      { ...reader, 503: retry+' IMAGE_UNAVAILABLE' }),
    },
    '/submissions/{id}/fields': { put: op('putFields', { summary: 'Record a complete confirmed field snapshot as owner',
      parameters: [id, key], requestBody: body(request.putFields), responses: updated },
      { ...writer, ...invalidBody, 409: writer[409]+' INCOMPLETE_PAGES FIELD_SNAPSHOT_CONFLICT',
        422: 'INVALID_FIELDS INVALID_FIELD DUPLICATE_FIELDS OCR_IMAGE_MISMATCH UNSUPPORTED_TEMPLATE' }) },
    '/submissions/{id}/complete': { post: op('completeSubmission', { summary: 'Validate intake and issue a durable acknowledgment',
      parameters: [id, key], requestBody: body(request.empty, false), responses: updated },
      { ...writer, ...invalidBody, 409: writer[409]+' INCOMPLETE_PAGES MISSING_FIELDS',
        422: 'INVALID_FIELDS UNSUPPORTED_TEMPLATE', 500: 'INTERNAL_ERROR INVALID_RECEIPT', 503: retry+' IMAGE_UNAVAILABLE' }) },
    '/verification/queue': { get: op('listReviewQueue', { summary: 'Read the completed verifier queue',
      parameters: query(true), responses: { 200: response('Review queue', list) } },
      { ...general, 400: invalid+' HTTPS_REQUIRED INVALID_QUEUE_FILTER', 403: denied }) },
    ...reviewPaths,
  },
};
