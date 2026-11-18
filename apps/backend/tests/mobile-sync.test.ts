import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { promisify } from 'node:util';
import sharp from 'sharp';
import { fieldKeys, newDraft, type OcrRun, type PageNumber, type RawField } from '@tala/core';
import { makeSyncSnapshot } from '../../scanner/src/syncSnapshot';
import { createApp } from '../src/app';
import { provision } from '../src/auth';
import { config } from '../src/config';
import { connect, migrate } from '../src/db';
import { checksum, PrivateDiskStore } from '../src/storage';
import { seedTemplates } from '../src/templates';

const execute = promisify(execFile);

test('P22-01 Android sync protocol uses real HTTP, PostgreSQL and private files', { timeout: 90000 }, async t => {
  assert.equal(process.env.TALA_ISOLATED_TEST_CLUSTER, '1');
  const testEndpoint = new URL(process.env.TALA_TEST_DATABASE_URL!);
  assert.equal(testEndpoint.hostname, '127.0.0.1');
  assert.equal(testEndpoint.username, 'tala_test');
  const bootstrap = connect(testEndpoint.href);
  await bootstrap.query('CREATE DATABASE tala_sync_test');
  await bootstrap.end();
  testEndpoint.pathname = '/tala_sync_test';
  await migrate(testEndpoint.href);
  const pool = connect(testEndpoint.href);
  t.after(() => pool.end());
  await seedTemplates(pool);
  const password = randomBytes(24).toString('hex');
  const encoder = await provision(pool, { email: 'sync-encoder@example.test', password, role: 'ENCODER' }, null);
  const verifier = await provision(pool, { email: 'sync-verifier@example.test', password, role: 'VERIFIER' }, null);
  const work = join(process.env.TALA_TEST_STORAGE!, '..', 'mobile-sync');
  const storageRoot = join(work, 'images');
  await mkdir(work, { recursive: true, mode: 0o700 });
  const storage = new PrivateDiskStore(storageRoot);
  const cfg = config({ DATABASE_URL: testEndpoint.href, STORAGE_ROOT: storageRoot, NODE_ENV: 'test', RATE_LIMIT: '1000' });
  const app = createApp(pool, storage, cfg);
  const observed: string[] = [];
  let dropCreate = true;
  let dropFirstPage = true;
  let pauseSecondPage = true;
  let dropComplete = true;
  let expireAccess = true;
  const server = createServer((req, res) => {
    void (async () => {
      const path = req.url ?? '';
      observed.push(req.method+' '+path);
      if (path.endsWith('/pages/2') && req.method === 'PUT' && pauseSecondPage) {
        pauseSecondPage = false;
        req.resume();
        res.writeHead(503, { 'Content-Type': 'application/json', 'Retry-After': '90' });
        res.end(JSON.stringify({ error: { code: 'DATABASE_UNAVAILABLE' } }));
        return;
      }
      if (path.endsWith('/status') && expireAccess) {
        expireAccess = false;
        const token = req.headers.authorization?.slice('Bearer '.length) ?? '';
        const tokenHash = createHash('sha256').update(token).digest('hex');
        const result = await pool.query("UPDATE sessions SET access_expires_at=now()-interval '1 sec' WHERE access_hash=$1", [tokenHash]);
        assert.equal(result.rowCount, 1);
      }
      const dropResponse = (path === '/api/v1/submissions' && req.method === 'POST' && dropCreate) ||
        (path.endsWith('/pages/1') && req.method === 'PUT' && dropFirstPage) ||
        (path.endsWith('/complete') && req.method === 'POST' && dropComplete);
      if (dropResponse) {
        const end = res.end;
        res.end = function (this: typeof res, ...args: unknown[]) {
          if (this.statusCode < 200 || this.statusCode > 299) return Reflect.apply(end, this, args);
          if (path.endsWith('/pages/1')) dropFirstPage = false;
          else if (path.endsWith('/complete')) dropComplete = false;
          else dropCreate = false;
          this.destroy();
          return this;
        } as typeof res.end;
      }
      app(req, res);
    })().catch(() => res.destroy());
  }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise<void>((resolve, reject) => server.close(err => err ? reject(err) : resolve())));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Isolated HTTP server did not start');
  const endpoint = 'http://127.0.0.1:'+address.port+'/api/v1';
  const date = '2026-11-18T00:00:00.000Z';
  const draft = newDraft(randomUUID(), date);
  const photos = await Promise.all(([1, 2] as const).map(async (page: PageNumber) => {
    const bytes = await sharp({ create: { width: 40, height: 56, channels: 3, background: page === 1 ? '#ccddaa' : '#ddccaa' } }).png().toBuffer();
    const imageId = randomUUID(), path = join(work, 'page-'+page+'.png');
    await writeFile(path, bytes, { mode: 0o600 });
    draft.pages[page] = { page, imageId, uri: 'file:///fixture/'+imageId+'.jpg', width: 40, height: 56, acceptedAt: date };
    return { number: page, imageId, mime: 'image/png', size: bytes.length, digest: checksum(bytes), key: randomUUID(), bytes };
  }));
  draft.values = { school_year: '2024-2025', grade_level: '7', lrn: '001234567890',
    learner_last_name: 'RIVERA', learner_first_name: 'ELENA', learner_middle_name: 'SANTOS', birth_date: '2012-02-29' };
  draft.confirmed = Object.fromEntries(Object.keys(draft.values).map(key => [key, true]));
  const region = { x: .15, y: .23, width: .28, height: .022 };
  const ocrRun: OcrRun = { id: randomUUID(), pageImageId: photos[0].imageId, at: date, engine: 'mlkit-bundled-latin-16.0.1',
    fields: Object.fromEntries<RawField>(fieldKeys.map(key =>
      [key, { text: key === 'lrn' ? 'OO123456789O' : draft.values[key], crop: region, regions: [region], elements: [] }])) as OcrRun['fields'] };
  draft.ocrHistory.push(ocrRun);
  draft.state = 'ready';
  const mapped = makeSyncSnapshot(draft);
  const pages = photos.map(({ bytes: _bytes, ...page }) => page);
  function withKeys(create: typeof mapped.create, fields: typeof mapped.fields) {
    return { create, fields, pages: pages.map(p => ({ ...p, key: randomUUID() })),
      createKey: randomUUID(), fieldsKey: randomUUID(), completeKey: randomUUID() };
  }
  const fixture = join(work, 'fictional-scenario.json');
  const invalidId = randomUUID();
  await writeFile(fixture, JSON.stringify({
    endpoint, email: encoder.email, verifierEmail: verifier.email, password, snapshot: withKeys(mapped.create, mapped.fields),
    invalidSnapshot: withKeys({ ...mapped.create, clientSubmissionId: invalidId },
      { fields: mapped.fields.fields.map(f => f.key === 'birth_date' ? { ...f, mobileValue: '2011-02-29' } : f) }),
  }), { mode: 0o600 });
  const { stdout } = await execute(process.env.TALA_SYNC_HOST_JAVA ?? 'java',
    ['-cp', process.env.TALA_SYNC_HOST_CLASSPATH!, 'expo.modules.talasync.SyncHostKt', fixture],
    { timeout: 65000, windowsHide: true });
  const result = JSON.parse(stdout) as { serverId: string; invalidId: string; receipt: string };
  assert.equal(observed.filter(s => s === 'PUT /api/v1/submissions/'+result.serverId+'/pages/1').length, 1);
  assert.equal(observed.filter(s => s === 'PUT /api/v1/submissions/'+result.serverId+'/pages/2').length, 2);
  assert.equal(observed.filter(s => s === 'POST /api/v1/submissions/'+result.serverId+'/complete').length, 1);
  assert(observed.filter(s => s === 'POST /api/v1/auth/refresh').length >= 2);
  assert.equal((await pool.query('SELECT count(*)::int AS count FROM submissions')).rows[0].count, 2);
  assert.equal((await pool.query('SELECT status FROM submissions WHERE id=$1 AND client_submission_id=$2', [result.invalidId, invalidId])).rows[0].status, 'UPLOADING');
  const stored = await pool.query('SELECT page_number,sha256,object_key FROM document_pages WHERE submission_id=$1 ORDER BY page_number', [result.serverId]);
  assert.deepEqual(stored.rows.map(p => p.page_number), [1, 2]);
  for (const [index, row] of stored.rows.entries()) {
    assert.equal(row.sha256, photos[index].digest);
    assert.deepEqual(await storage.read(row.object_key), photos[index].bytes);
  }
  const login = await fetch(endpoint+'/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: verifier.email, password, mode: 'native' }) });
  assert.equal(login.status, 200);
  const bearer = 'Bearer '+(await login.json()).accessToken;
  const verified = await fetch(endpoint+'/submissions/'+result.serverId, { headers: { Authorization: bearer } });
  assert.equal(verified.status, 200);
  const record = await verified.json();
  assert.equal(record.clientSubmissionId, draft.id);
  assert.equal(record.status, 'NEEDS_CORRECTION');
  assert.equal(record.decision.notes, 'Fictional fixture needs review.');
  assert.equal(record.receipt.acknowledgedAt, result.receipt);
  const lrn = record.fields.find((f: { key: string }) => f.key === 'lrn');
  assert.equal(lrn.ocr.original, 'OO123456789O');
  assert.equal(lrn.mobileValue, '001234567890');
  assert.equal(lrn.ocr.imageId, photos[0].imageId);
  assert.deepEqual(lrn.ocr.regions, [region]);
});
