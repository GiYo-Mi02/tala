import { randomUUID } from 'node:crypto';
import express from 'express';
import type { Request, Response, RequestHandler, ErrorRequestHandler } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { resolve, join } from 'node:path';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import type { Pool } from 'pg';
import type { Config } from './config';
import { authenticate, authenticateLogin, refreshSession, revokeSession, provision, changeAccount, type Actor } from './auth';
import * as schema from './contracts';
import { ApiError, requireCondition } from './errors';
import { Submissions, type ReviewAction } from './submissions';
import { getTemplate } from './templates';
import type { ObjectStore } from './storage';

const cookieName = '__Secure-tala-refresh';
const cookieOptions = { httpOnly:true, secure:true, sameSite:'strict' as const, path:'/api/v1/auth' };
const browserCookie = (req: Request) => req.headers.cookie?.split(';').map(s=>s.trim())
  .find(s=>s.startsWith(cookieName+'='))?.slice(cookieName.length+1);
const actor = (res: Response): Actor => res.locals.actor;
function parse<T extends z.ZodType>(check: T, value: unknown): z.infer<T> {
  const decoded = check.safeParse(value);
  if (!decoded.success) throw new ApiError(400,'INVALID_REQUEST','Request does not match the endpoint contract.',
    [...new Set(decoded.error.issues.map(i=>i.path.join('.')||'request'))]);
  return decoded.data;
}
const requestKey = (req: Request) => parse(schema.id,req.get('Idempotency-Key'));
const resourceId = (req: Request) => parse(schema.id,req.params.id);
function revision(req: Request) {
  const header = req.get('If-Match');
  if (header === undefined) throw new ApiError(428,'REVISION_REQUIRED','Send the last submission ETag in If-Match.');
  const value = /^"([1-9][0-9]{0,9})"$/.exec(header)?.[1];
  requireCondition(value && Number(value) <= 2147483647,400,'INVALID_REVISION','If-Match must be a quoted submission revision.');
  return Number(value);
}
function sendMutation(res: Response, result: Awaited<ReturnType<Submissions['create']>>) {
  res.set('ETag','"'+result.body.revision+'"');
  if (result.replay) res.set('Idempotency-Replayed','true');
  return res.status(result.statusCode).json(result.body);
}
function permits(...allowed: schema.Role[]): RequestHandler {
  return (_req,res,next) => {
    if (!allowed.includes(actor(res).role)) return next(new ApiError(403,'FORBIDDEN','This role cannot perform that operation.'));
    next();
  };
}

export function createApp(pool: Pool, storage: ObjectStore, cfg: Config, reportError = (requestId: string, name: string) => {
  console.error(JSON.stringify({ event:'api_error',requestId,errorType:name }));
}) {
  const app = express();
  const api = express.Router();
  const service = new Submissions(pool,storage);
  const origins = new Set(cfg.CORS_ORIGINS.split(',').map(v=>v.trim()).filter(Boolean));
  const encoder = permits('ENCODER');
  const verifier = permits('VERIFIER');
  const recordReader = permits('ENCODER','VERIFIER');
  app.disable('x-powered-by');
  app.disable('etag');
  if (cfg.TRUST_LOOPBACK_PROXY === 'true') app.set('trust proxy','loopback');
  app.use(helmet({ crossOriginResourcePolicy: { policy:'same-site' }, contentSecurityPolicy: { directives: {
    defaultSrc:["'self'"], connectSrc:["'self'"], imgSrc:["'self'",'blob:','data:'],
    fontSrc:["'self'"], styleSrc:["'self'","'unsafe-inline'"], workerSrc:["'self'"], formAction:["'self'"],
  } } }));
  app.use((req,res,next) => {
    res.locals.requestId = randomUUID();
    res.set({ 'X-Request-Id':res.locals.requestId,'Cache-Control':'private, no-store' });
    if (cfg.NODE_ENV==='production' && !req.secure) return next(new ApiError(400,'HTTPS_REQUIRED','Use HTTPS for the API.'));
    next();
  });
  app.use(cors({ origin: (origin,callback)=>callback(null,!!origin && origins.has(origin)),credentials:true,
    allowedHeaders:['Authorization','Content-Type','Idempotency-Key','If-Match','X-Image-Id','X-Content-SHA256'],
    exposedHeaders:['ETag','Idempotency-Replayed','Retry-After','X-Request-Id'] }));
  app.use('/api/v1',api);

  function limiter(max: number, name: string): RequestHandler {
    return rateLimit({ windowMs:60_000,limit:max,standardHeaders:'draft-8',legacyHeaders:false,identifier:name,
      handler: (_req,_res,next)=>next(new ApiError(429,'RATE_LIMITED','Too many requests. Retry after the indicated delay.')) });
  }
  api.use(limiter(cfg.RATE_LIMIT,'api'));
  const json = express.json({ limit:'2mb',strict:true });
  const smallJson = express.json({ limit:'16kb',strict:true });
  const signedIn: RequestHandler = async (req,res,next) => {
    res.locals.actor = await authenticate(pool,req.get('Authorization'));
    next();
  };
  function browserRequest(req: Request) {
    requireCondition(req.secure && origins.has(req.get('Origin')??''),403,'BROWSER_ORIGIN_REQUIRED',
      'Browser sessions require HTTPS and an allowed Origin.');
  }
  function sessionResponse(res: Response, mode: Actor['mode'], pair: Awaited<ReturnType<typeof refreshSession>>) {
    if (mode === 'native') return res.json(pair);
    const { refreshToken,...access } = pair;
    res.cookie(cookieName,refreshToken,cookieOptions);
    return res.json(access);
  }

  api.get('/health', async (_req,res) => {
    try { await pool.query('SELECT 1'); }
    catch { throw new ApiError(503,'DATABASE_UNAVAILABLE','The database is unavailable.'); }
    res.json({ status:'ok' });
  });
  api.post('/auth/login',limiter(8,'login'),smallJson,async (req,res) => {
    const body = parse(schema.login,req.body);
    if (body.mode === 'browser') browserRequest(req);
    return sessionResponse(res,body.mode,await authenticateLogin(pool,body.email,body.password,body.mode));
  });
  function refreshInput(req: Request) {
    const body = parse(schema.refresh,req.body??{});
    const cookie = browserCookie(req);
    requireCondition(!(body.refreshToken && cookie),400,'AMBIGUOUS_CREDENTIAL','Use only one refresh credential.');
    if (cookie) {
      browserRequest(req);
      return { mode:'browser' as const, value:parse(schema.refresh,{refreshToken:cookie}).refreshToken! };
    }
    requireCondition(body.refreshToken,401,'AUTH_REQUIRED','A refresh credential is required.');
    return { mode:'native' as const,value:body.refreshToken };
  }
  api.post('/auth/refresh',limiter(25,'refresh'),smallJson,async (req,res) => {
    const input=refreshInput(req);
    return sessionResponse(res,input.mode,await refreshSession(pool,input.value,input.mode));
  });
  api.post('/auth/logout',smallJson,async (req,res) => {
    const input=refreshInput(req);
    await revokeSession(pool,input.value,input.mode);
    if (input.mode==='browser') res.clearCookie(cookieName,cookieOptions);
    return res.sendStatus(204);
  });
  api.get('/auth/me',signedIn,(_req,res) => {
    const {id,email,role}=actor(res);
    res.json({id,email,role});
  });
  api.post('/admin/users',signedIn,permits('ADMIN'),limiter(10,'admin'),smallJson,async (req,res) => {
    res.status(201).json(await provision(pool,parse(schema.userCreate,req.body),actor(res)));
  });
  api.patch('/admin/users/:id',signedIn,permits('ADMIN'),smallJson,async (req,res) => {
    res.json(await changeAccount(pool,actor(res),resourceId(req),parse(schema.userUpdate,req.body).active));
  });

  api.get('/templates',signedIn,async (_req,res) => {
    res.json({ items:(await pool.query('SELECT id,version,name,metadata FROM document_templates ORDER BY id,version')).rows });
  });
  api.get('/templates/:id/versions/:version',signedIn,async (req,res) => {
    res.json(await getTemplate(pool,parse(z.string().regex(/^[a-z0-9-]{1,100}$/),req.params.id),
      parse(z.coerce.number().int().positive().max(2147483647),req.params.version)));
  });

  const authorized = express.Router();
  api.use('/submissions',signedIn,authorized);
  authorized.post('/',encoder,json,async (req,res) => sendMutation(res,
    await service.create(actor(res),requestKey(req),parse(schema.createSubmission,req.body))));
  authorized.get('/',recordReader,async (req,res) => {
    res.json(await service.list(actor(res),parse(schema.submissionQuery,req.query)));
  });
  authorized.get('/overview',verifier,async (_req,res) => {
    res.json(await service.overview(actor(res)));
  });
  authorized.get('/:id',recordReader,async (req,res) => {
    const result = await service.details(actor(res),resourceId(req));
    res.set('ETag','"'+result.revision+'"').json(result);
  });
  authorized.get('/:id/status',recordReader,async (req,res) => {
    const result = await service.details(actor(res),resourceId(req),true);
    res.set('ETag','"'+result.revision+'"').json(result);
  });
  authorized.put('/:id/pages/:pageNumber',encoder,limiter(30,'upload'),
    (req,_res,next) => {
      if (!['image/jpeg','image/png'].includes(req.get('Content-Type')??''))
        return next(new ApiError(415,'UNSUPPORTED_MEDIA','Send image/jpeg or image/png.'));
      next();
    },express.raw({ type:['image/jpeg','image/png'],limit:cfg.MAX_PAGE_BYTES,inflate:false }),
    async (req,res) => {
      requireCondition(Buffer.isBuffer(req.body),400,'EMPTY_UPLOAD','Upload the image bytes as the request body.');
      const info = parse(schema.pageUpload,{ pageNumber:req.params.pageNumber,imageId:req.get('X-Image-Id'),checksum:req.get('X-Content-SHA256') });
      return sendMutation(res,await service.upload(actor(res),requestKey(req),resourceId(req),info,req.body,req.get('Content-Type')!));
    });
  authorized.get('/:id/pages/:pageNumber',recordReader,async (req,res) => {
    const image = await service.image(actor(res),resourceId(req),parse(schema.number,req.params.pageNumber));
    res.type(image.mime).set('Cross-Origin-Resource-Policy','cross-origin').send(image.bytes);
  });
  authorized.put('/:id/fields',encoder,json,async (req,res) => sendMutation(res,
    await service.putFields(actor(res),requestKey(req),resourceId(req),parse(schema.putFields,req.body))));
  authorized.post('/:id/complete',encoder,smallJson,async (req,res) => {
    parse(schema.empty,req.body??{});
    return sendMutation(res,await service.complete(actor(res),requestKey(req),resourceId(req)));
  });

  api.get('/verification/queue',signedIn,verifier,async (req,res) => {
    const query = parse(schema.pageQuery,req.query);
    requireCondition(query.status===undefined || ['PENDING_VERIFICATION','IN_REVIEW'].includes(query.status),
      400,'INVALID_QUEUE_FILTER','Filter the review queue by pending or in review.');
    res.json(await service.list(actor(res),{...query,status:query.status??'PENDING_VERIFICATION'}));
  });
  const reviewSchemas = { claim:schema.empty,correct:schema.correction,verify:schema.reviewNotes,
    return:schema.reason,reject:schema.reason,finalize:schema.reviewNotes };
  for (const [action, body] of Object.entries(reviewSchemas)) {
    authorized.post('/:id/review/'+action,verifier,json,async (req,res) =>
      sendMutation(res,await service.review(actor(res),requestKey(req),resourceId(req),revision(req),
        action as ReviewAction,parse(body,req.body??{}))));
  }

  if (cfg.WEB_ROOT) {
    const root = resolve(cfg.WEB_ROOT);
    app.use('/assets',express.static(join(root,'assets'),{ index:false,redirect:false,dotfiles:'deny',
      setHeaders: res=>res.setHeader('Cache-Control','public, max-age=31536000, immutable') }));
    for (const file of ['index.html','sw.js','manifest.webmanifest','icon-192.png','icon-512.png','icon-maskable.png']) {
      app.get('/'+file,(_req,res)=>res.sendFile(file,{root,headers:{'Cache-Control':'no-cache'}}));
    }
    app.get(/^(?!\/(?:api|assets)(?:\/|$)).*/, (req,res,next)=>{
      if (!req.get('Accept')?.includes('text/html')) return next();
      res.sendFile('index.html',{root,headers:{'Cache-Control':'no-cache'}});
    });
  }
  app.use((_req,_res,next) => next(new ApiError(404,'NOT_FOUND','Route not found.')));
  const onError: ErrorRequestHandler = (error,_req,res,next) => {
    if (res.headersSent) return next(error);
    if (error.type === 'entity.too.large') error = new ApiError(413,'TOO_LARGE','Request exceeds the configured limit.');
    else if (error.type === 'entity.parse.failed' || error.type === 'request.size.invalid')
      error = new ApiError(400,'INVALID_REQUEST','The request body could not be parsed.');
    else if (error.type === 'request.aborted')
      error = new ApiError(400,'INVALID_REQUEST','The request body was interrupted.');
    else if (error.type === 'encoding.unsupported' || error.type === 'charset.unsupported')
      error = new ApiError(415,'UNSUPPORTED_MEDIA','The request encoding is unsupported.');
    else if (['40001','40P01','55P03','57014','57P01','08006','ECONNREFUSED'].includes(error.code))
      error = new ApiError(503,'DATABASE_UNAVAILABLE','The database operation could not complete. Retry with the same key.');
    if (!(error instanceof ApiError)) {
      reportError(res.locals.requestId,error?.constructor?.name ?? 'UnknownError');
      error = new ApiError(500,'INTERNAL_ERROR','The request could not be completed.');
    }
    if (error.status===401) res.set('WWW-Authenticate','Bearer');
    res.status(error.status).json({ error:{ code:error.code,message:error.message,requestId:res.locals.requestId,
      ...(error.fields?{fields:error.fields}:{}) } });
  };
  app.use(onError);
  return app;
}
