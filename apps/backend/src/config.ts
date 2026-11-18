import { existsSync, readFileSync } from 'node:fs';
import { relative, isAbsolute, sep } from 'node:path';
import { parseEnv } from 'node:util';
import { z } from 'zod';

const environment = z.object({
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  STORAGE_ROOT: z.string().trim().min(1),
  HOST: z.string().default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1).max(65535).default(8788),
  NODE_ENV: z.enum(['development','test','production']).default('development'),
  CORS_ORIGINS: z.string().default(''),
  MAX_PAGE_BYTES: z.coerce.number().int().min(1024).max(25_000_000).default(10_000_000),
  TLS_CERT_FILE: z.string().optional(),
  TLS_KEY_FILE: z.string().optional(),
  TRUST_LOOPBACK_PROXY: z.enum(['true','false']).default('false'),
  WEB_ROOT: z.string().trim().min(1).optional(),
  RETAIN_INCOMPLETE_DAYS: z.coerce.number().int().min(1).max(365).default(30),
  RATE_LIMIT: z.coerce.number().int().min(5).max(1000).default(120),
}).superRefine((v, ctx) => {
  const originAllowed = v.CORS_ORIGINS.split(',').map(s => s.trim()).filter(Boolean).every(s => {
    try {
      const url = new URL(s);
      return url.origin === s && (url.protocol === 'https:' || v.NODE_ENV !== 'production' && url.protocol === 'http:');
    } catch { return false; }
  });
  const loopback = ['127.0.0.1','::1'].includes(v.HOST);
  if (!originAllowed) ctx.addIssue({ code: 'custom', path: ['CORS_ORIGINS'], message: 'Use exact HTTP(S) origins.' });
  if (Boolean(v.TLS_CERT_FILE) !== Boolean(v.TLS_KEY_FILE)) ctx.addIssue({ code: 'custom', message: 'Provide both TLS files.' });
  if (v.TRUST_LOOPBACK_PROXY === 'true' && !loopback) ctx.addIssue({ code: 'custom', message: 'A trusted loopback proxy requires loopback binding.' });
  if (!v.TLS_CERT_FILE && (!loopback || v.NODE_ENV === 'production' && v.TRUST_LOOPBACK_PROXY !== 'true'))
    ctx.addIssue({ code: 'custom', message: 'Use direct HTTPS or a loopback HTTPS reverse proxy.' });
  if (v.WEB_ROOT) {
    const inside = (parent:string, child:string) => {
      const path = relative(parent,child);
      return path === '' || path !== '..' && !path.startsWith('..'+sep) && !isAbsolute(path);
    };
    if (inside(v.WEB_ROOT,v.STORAGE_ROOT) || inside(v.STORAGE_ROOT,v.WEB_ROOT))
      ctx.addIssue({ code:'custom',path:['WEB_ROOT'],message:'Public and private storage directories must be separate.' });
  }
});
export type Config = z.infer<typeof environment>;
export function config(input = process.env): Config {
  const out = environment.safeParse(input);
  if (!out.success) throw new Error('Invalid backend configuration: ' + out.error.issues.map(i => i.path.length ? i.path.join('.') : i.message).join(', '));
  return out.data;
}
function readEnv(file:string) {
  return parseEnv(readFileSync(file,'utf8').replace(/^\uFEFF/,''));
}

export function loadLocalEnv() {
  const local = existsSync('.env') ? readEnv('.env') : {};
  const sharedFile = process.env.TALA_BACKEND_ENV_FILE || local.TALA_BACKEND_ENV_FILE;
  if (sharedFile && !existsSync(sharedFile)) throw new Error('Invalid backend configuration: TALA_BACKEND_ENV_FILE is missing.');
  const values = sharedFile ? { ...readEnv(sharedFile), ...local } : local;
  for (const [key,value] of Object.entries(values)) {
    if (process.env[key]===undefined) process.env[key]=value;
  }
}
