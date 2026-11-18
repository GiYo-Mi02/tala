import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash,randomBytes,randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { request as httpRequest } from 'node:http';
import { utimes } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import { sssTemplate,newFixedDraft,activeFixedFields } from '@tala/core';
import { config } from '../src/config';
import { connect,migrate } from '../src/db';
import { seedTemplates } from '../src/templates';
import { provision } from '../src/auth';
import { createApp } from '../src/app';
import { checksum,PrivateDiskStore,type ObjectStore } from '../src/storage';
import { maintenance } from '../src/maintenance';

test('Phase 2.1 HTTP and PostgreSQL integration', { timeout:120_000 }, async t => {
  assert.equal(process.env.TALA_ISOLATED_TEST_CLUSTER,'1','Run npm run test:postgres to provision an isolated database.');
  const connection = process.env.TALA_TEST_DATABASE_URL!;
  assert.equal(new URL(connection).username,'tala_test');
  assert.equal(new URL(connection).hostname,'127.0.0.1');
  const pool = connect(connection);
  const cfg = config({ DATABASE_URL:connection,STORAGE_ROOT:process.env.TALA_TEST_STORAGE!,
    NODE_ENV:'test',MAX_PAGE_BYTES:'12000',RATE_LIMIT:'1000',CORS_ORIGINS:'https://portal.tala.test',TRUST_LOOPBACK_PROXY:'true' });
  const disk = new PrivateDiskStore(cfg.STORAGE_ROOT);
  const testErrors: string[] = [];
  let failStorage=false;
  const storage: ObjectStore = {
    put: async (key,bytes)=>{ if(failStorage)throw new Error('simulated disk failure'); await disk.put(key,bytes); },
    read:key=>disk.read(key),remove:key=>disk.remove(key),
  };
  const app=createApp(pool,storage,cfg,(_id,error)=>testErrors.push(error));
  const server=app.listen(0,'127.0.0.1');
  await once(server,'listening');
  const address=server.address();
  if(!address||typeof address==='string')throw new Error('HTTP listener unavailable');
  const base='http://127.0.0.1:'+address.port+'/api/v1';
  t.after(async()=>{await new Promise<void>(resolve=>server.close(()=>resolve()));await pool.end();});
  type Options={ auth?:string; json?:unknown; bytes?:Buffer; key?:string; revision?:string; headers?:Record<string,string> };
  async function request(method:string,path:string,options:Options={}) {
    const headers:Record<string,string>={ ...options.headers };
    if(options.auth) headers.Authorization='Bearer '+options.auth;
    if(options.key) headers['Idempotency-Key']=options.key;
    if(options.revision) headers['If-Match']=options.revision;
    if(options.json!==undefined) headers['Content-Type']='application/json';
    const body=options.bytes ? Uint8Array.from(options.bytes) : options.json===undefined ? undefined : JSON.stringify(options.json);
    const response=await fetch(base+path,{method,headers,body});
    const data=response.headers.get('Content-Type')?.includes('application/json') ? await response.json() : Buffer.from(await response.arrayBuffer());
    return { status:response.status,data,headers:response.headers };
  }
  function expectStatus(result:Awaited<ReturnType<typeof request>>,status:number,code?:string) {
    assert.equal(result.status,status,JSON.stringify(result.data));
    if(code) assert.equal(result.data.error.code,code);
    return result;
  }
  const password=randomBytes(20).toString('hex');
  const emails={encoder:'encoder@example.test',other:'other@example.test',verifier:'reviewer@example.test',
    second:'reviewer2@example.test',admin:'admin@example.test'};
  let encoder='',other='',verifier='',second='',admin='',otherId='';
  let encRefresh='';
  const createBody={clientSubmissionId:randomUUID(),templateId:'beef-sy-2024-2025',templateVersion:1,capturedAt:'2026-11-18T00:00:00.000Z'};
  let submission='',completionKey='',revision='',claimRevision='';
  const jpeg=await sharp({create:{width:32,height:40,channels:3,background:'#e9ded6'}}).jpeg().toBuffer();
  const png=await sharp({create:{width:40,height:52,channels:3,background:'#dfd'}}).png().toBuffer();
  const ids=[randomUUID(),randomUUID()];
  const fields = Object.entries({school_year:'2024-2025',grade_level:'7',lrn:'001234567890',
    learner_last_name:'RIVERA',learner_first_name:'ELENA',learner_middle_name:'',birth_date:'2012-02-29'})
    .map(([key,mobileValue])=>({key,mobileValue,confirmed:true,ocr:key==='lrn'?
      { original:'OO123456789O',imageId:ids[0],runId:randomUUID(),engine:'mlkit-bundled-latin-16.0.1',
        confidence:.71,regions:[{x:.2,y:.1,width:.2,height:.02}] }:null}));
  const resultKey=()=>({key:randomUUID()});
  const create=(clientSubmissionId=randomUUID(),auth=encoder)=>request('POST','/submissions',{auth,...resultKey(),json:{...createBody,clientSubmissionId}});
  function upload(id:string,n:number,bytes:Buffer,mime:string,key:string,imageId=ids[n-1],sha=checksum(bytes)) {
    return request('PUT','/submissions/'+id+'/pages/'+n,{auth:encoder,key,bytes,
      headers:{'Content-Type':mime,'X-Image-Id':imageId,'X-Content-SHA256':sha}});
  }
  const route=()=>'/submissions/'+submission;
  const act=(name:string,auth:string,rev:string,json:Record<string,unknown>={}) =>
    request('POST',route()+'/review/'+name,{auth,revision:rev,json,...resultKey()});

  await t.test('P21-01 real PostgreSQL, repeatable migration, seed and standalone clean startup',async()=>{
    assert.equal((await pool.query('SHOW server_version')).rows[0].server_version.split('.')[0],'18');
    assert.equal((await migrate(connection)).filter(x=>x.status==='Success').length,1);
    assert.equal((await migrate(connection)).length,0);
    await seedTemplates(pool);await seedTemplates(pool);
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM template_fields')).rows[0].n,143);
    expectStatus(await request('GET','/health'),200);
    const probe=createApp(pool,disk,cfg).listen(0,'127.0.0.1');await once(probe,'listening');
    const listen=probe.address();if(typeof listen==='string'||!listen)throw new Error();
    const port=listen.port;await new Promise<void>(r=>probe.close(()=>r()));
    const child=spawn(process.execPath,['--import','tsx','src/server.ts'],{windowsHide:true,stdio:['ignore','pipe','pipe'],
      env:{ PATH:process.env.PATH, SystemRoot:process.env.SystemRoot, TEMP:process.env.TEMP, TMP:process.env.TMP,
        DATABASE_URL:connection,STORAGE_ROOT:cfg.STORAGE_ROOT,PORT:String(port),HOST:'127.0.0.1',NODE_ENV:'test' }});
    try {
      await new Promise<void>((resolve,reject)=>{
        const timer=setTimeout(()=>reject(new Error('Standalone startup timed out')),15000);
        child.once('exit',code=>{clearTimeout(timer);reject(new Error('Standalone startup exited '+code));});
        child.stdout.on('data',bytes=>{if(String(bytes).includes('T.A.L.A. API listening')){clearTimeout(timer);resolve();}});
      });
      assert.equal((await fetch('http://127.0.0.1:'+port+'/api/v1/health')).status,200);
    } finally { child.kill();if(child.exitCode===null)await once(child,'exit'); }
  });
  await t.test('P21-02 provisioned accounts, roles, rotated credentials and rejected refresh reuse',async()=>{
    for(const [key,email] of Object.entries(emails)){
      const role=key==='admin'?'ADMIN':key==='encoder'||key==='other'?'ENCODER':'VERIFIER';
      const user=await provision(pool,{email,password,role},null);
      if(key==='other')otherId=user.id;
    }
    const login=(email:string)=>request('POST','/auth/login',{json:{email,password,mode:'native'}});
    const first=expectStatus(await login(emails.encoder),200).data;
    const rotated=expectStatus(await request('POST','/auth/refresh',{json:{refreshToken:first.refreshToken}}),200).data;
    expectStatus(await request('POST','/auth/refresh',{json:{refreshToken:first.refreshToken}}),401,'INVALID_REFRESH');
    expectStatus(await request('GET','/auth/me',{auth:first.accessToken}),401);
    encoder=rotated.accessToken;encRefresh=rotated.refreshToken;
    other=expectStatus(await login(emails.other),200).data.accessToken;
    verifier=expectStatus(await login(emails.verifier),200).data.accessToken;
    second=expectStatus(await login(emails.second),200).data.accessToken;
    admin=expectStatus(await login(emails.admin),200).data.accessToken;
    assert.equal(expectStatus(await request('GET','/auth/me',{auth:encoder}),200).data.role,'ENCODER');
    expectStatus(await request('GET','/verification/queue',{auth:encoder}),403);
    expectStatus(await request('GET','/submissions',{auth:admin}),403);
    expectStatus(await create(randomUUID(),verifier),403);
  });
  await t.test('P21-03 database-backed template catalog, strict validation and concurrent duplicate prevention',async()=>{
    expectStatus(await request('GET','/templates'),401);
    assert.equal(expectStatus(await request('GET','/templates',{auth:encoder}),200).data.items.length,2);
    const sss=expectStatus(await request('GET','/templates/'+sssTemplate.id+'/versions/1',{auth:encoder}),200).data;
    assert.equal(sss.fields.length,136);
    assert.deepEqual(sss.pages.map((p:{pageNumber:number;capture:boolean})=>[p.pageNumber,p.capture]),[[1,true],[2,false],[3,true]]);
    expectStatus(await request('GET','/templates/'+sssTemplate.id+'/versions/999',{auth:encoder}),404);
    expectStatus(await request('POST','/submissions',{auth:encoder,...resultKey(),json:{...createBody,password:'secret'}}),400,'INVALID_REQUEST');
    const key=randomUUID();
    const inputs=await Promise.all([key,key,randomUUID()].map(idempotencyKey=>request('POST','/submissions',{auth:encoder,key:idempotencyKey,json:createBody})));
    assert(inputs.every(r=>[200,201].includes(r.status)),JSON.stringify(inputs));
    submission=inputs[0].data.id;
    assert(inputs.every(r=>r.data.id===submission));
    assert(inputs.some(r=>r.headers.get('Idempotency-Replayed')==='true'));
    expectStatus(await request('POST','/submissions',{auth:encoder,key,json:{...createBody,clientSubmissionId:randomUUID()}}),409,'IDEMPOTENCY_CONFLICT');
    expectStatus(await request('POST','/submissions',{auth:encoder,...resultKey(),json:{...createBody,capturedAt:'2026-11-18T01:00:00Z'}}),409,'CLIENT_ID_CONFLICT');
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM submissions')).rows[0].n,1);
  });
  await t.test('P21-04 private partial upload, file rejection, size limits and storage rollback',async()=>{
    expectStatus(await request('POST',route()+'/complete',{auth:encoder,...resultKey()}),409,'INCOMPLETE_PAGES');
    expectStatus(await request('GET',route(),{auth:verifier}),404);
    expectStatus(await upload(submission,1,Buffer.from('fake'),'image/jpeg',randomUUID()),415,'INVALID_IMAGE');
    expectStatus(await upload(submission,1,jpeg,'image/jpeg',randomUUID(),ids[0],'1'.repeat(64)),422,'CHECKSUM_MISMATCH');
    expectStatus(await upload(submission,1,Buffer.alloc(12001),'image/jpeg',randomUUID()),413,'TOO_LARGE');
    failStorage=true;
    const uploadKey=randomUUID();
    expectStatus(await upload(submission,1,jpeg,'image/jpeg',uploadKey),503,'STORAGE_UNAVAILABLE');
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM document_pages')).rows[0].n,0);
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM sync_operations WHERE idempotency_key=$1',[uploadKey])).rows[0].n,0);
    failStorage=false;
    expectStatus(await upload(submission,1,jpeg,'image/jpeg',uploadKey),201);
    assert.equal(expectStatus(await upload(submission,1,jpeg,'image/jpeg',uploadKey),201).headers.get('Idempotency-Replayed'),'true');
    expectStatus(await upload(submission,1,jpeg,'image/jpeg',randomUUID()),200);
    expectStatus(await upload(submission,1,png,'image/png',randomUUID()),409,'PAGE_CONFLICT');
    expectStatus(await request('GET',route()+'/pages/1'),401);
    expectStatus(await request('GET',route()+'/pages/1',{auth:other}),404);
    expectStatus(await request('GET',route()+'/pages/1',{auth:verifier}),404);
    expectStatus(await request('POST',route()+'/complete',{auth:encoder,...resultKey()}),409,'INCOMPLETE_PAGES');
    const pageTwoKey=randomUUID();
    await new Promise<void>((resolve,reject)=>{
      const interrupted=httpRequest(base+route()+'/pages/2',{method:'PUT',headers:{
        Authorization:'Bearer '+encoder, 'Content-Type':'image/png', 'Content-Length':png.length,
        'X-Image-Id':ids[1], 'X-Content-SHA256':checksum(png), 'Idempotency-Key':pageTwoKey,
      }});
      interrupted.once('response',()=>reject(new Error('An incomplete upload received an HTTP response')));
      interrupted.once('error',(error:NodeJS.ErrnoException)=>error.code==='ECONNRESET'?resolve():reject(error));
      interrupted.write(png.subarray(0,Math.floor(png.length/2)),()=>interrupted.destroy());
    });
    const partial=expectStatus(await request('GET',route()+'/status',{auth:encoder}),200).data;
    assert.deepEqual(partial.pages.map((p:{pageNumber:number})=>p.pageNumber),[1]);
    assert.equal(partial.receipt,null);
    expectStatus(await upload(submission,2,png,'image/png',pageTwoKey),201);
    expectStatus(await request('POST',route()+'/complete',{auth:encoder,...resultKey()}),409,'MISSING_FIELDS');
  });
  await t.test('P21-05 atomic OCR snapshot, relational constraints and stable receipt',async()=>{
    const wrong=fields.map(f=>f.ocr?{...f,ocr:{...f.ocr,imageId:ids[1]}}:f);
    const key=randomUUID();
    expectStatus(await request('PUT',route()+'/fields',{auth:encoder,key,json:{fields:wrong}}),422,'OCR_IMAGE_MISMATCH');
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM field_values')).rows[0].n,0);
    expectStatus(await request('PUT',route()+'/fields',{auth:encoder,key,json:{fields}}),200);
    expectStatus(await request('PUT',route()+'/fields',{auth:encoder,...resultKey(),json:{fields:[...fields].reverse()}}),200);
    await assert.rejects(pool.query("UPDATE field_values SET ocr_original='overwrite' WHERE submission_id=$1 AND field_key='lrn'",[submission]));
    await assert.rejects(pool.query('UPDATE document_pages SET page_number=5 WHERE submission_id=$1 AND page_number=2',[submission]),{code:'23503'});
    completionKey=randomUUID();
    const done=expectStatus(await request('POST',route()+'/complete',{auth:encoder,key:completionKey}),200);
    revision=done.headers.get('ETag')!;
    assert.equal(done.data.status,'PENDING_VERIFICATION');
    const receipt=expectStatus(await request('GET',route()+'/status',{auth:encoder}),200).data;
    assert.equal(receipt.receipt.submissionId,submission);
    assert.deepEqual(receipt.pages.map((p:{pageNumber:number})=>p.pageNumber),[1,2]);
    assert(!JSON.stringify(receipt).includes('object_key'));
    assert.equal(expectStatus(await request('GET','/verification/queue',{auth:verifier}),200).data.items.length,1);
    assert.deepEqual(expectStatus(await request('GET',route()+'/pages/1',{auth:verifier}),200).data,jpeg);
  });
  await t.test('P21-06 claim, stale edit, correction, verify, finalize and four distinct values',async()=>{
    expectStatus(await act('verify',verifier,revision),403);
    expectStatus(await act('claim',encoder,revision),403);
    const claim=expectStatus(await act('claim',verifier,revision),200);
    claimRevision=claim.headers.get('ETag')!;
    expectStatus(await act('correct',second,claimRevision,{fields:[{key:'lrn',value:'001234567891'}]}),403);
    expectStatus(await act('correct',verifier,revision,{fields:[{key:'lrn',value:'001234567891'}]}),412,'STALE_REVISION');
    expectStatus(await act('correct',verifier,claimRevision,{fields:[{key:'lrn',value:'oops'}]}),422,'INVALID_FIELDS');
    const changed=expectStatus(await act('correct',verifier,claimRevision,{fields:[{key:'lrn',value:'001234567891'}]}),200);
    const verified=expectStatus(await act('verify',verifier,changed.headers.get('ETag')!),200);
    const pendingFinal=expectStatus(await request('GET',route(),{auth:verifier}),200).data.fields.find((f:{key:string})=>f.key==='lrn');
    assert.equal(pendingFinal.finalValue,null);
    const final=expectStatus(await act('finalize',verifier,verified.headers.get('ETag')!),200);
    assert.equal(final.data.status,'FINALIZED');
    const read=expectStatus(await request('GET',route(),{auth:encoder}),200).data;
    const val=read.fields.find((f:{key:string})=>f.key==='lrn');
    assert.equal(val.ocr.original,'OO123456789O');
    assert.equal(val.mobileValue,'001234567890');
    assert.equal(val.reviewValue,'001234567891');
    assert.equal(val.finalValue,'001234567891');
    const replay=expectStatus(await request('POST',route()+'/complete',{auth:encoder,key:completionKey}),200);
    assert.equal(replay.data.status,'PENDING_VERIFICATION');
    assert.equal(replay.headers.get('ETag'),revision);
    const newKey=expectStatus(await request('POST',route()+'/complete',{auth:encoder,...resultKey()}),200);
    assert.deepEqual(newKey.data,replay.data);
    const replacement=createApp(pool,disk,cfg).listen(0,'127.0.0.1');
    await once(replacement,'listening');
    try {
      const newAddress=replacement.address();
      if(!newAddress||typeof newAddress==='string')throw new Error('Second HTTP listener unavailable');
      const status=await fetch('http://127.0.0.1:'+newAddress.port+'/api/v1'+route()+'/status',
        {headers:{Authorization:'Bearer '+encoder}});
      assert.equal(status.status,200);
      assert.equal((await status.json()).status,'FINALIZED');
    } finally { await new Promise<void>(resolve=>replacement.close(()=>resolve())); }
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM verification_records WHERE submission_id=$1",[submission])).rows[0].n,4);
    await assert.rejects(pool.query("UPDATE audit_logs SET action='tamper' WHERE submission_id=$1",[submission]));
  });
  await t.test('P21-07 returned/rejected outcomes remain terminal and require reasons',async()=>{
    for(const decision of ['return','reject']){
      const fresh=expectStatus(await create(),201).data.id;
      expectStatus(await upload(fresh,1,jpeg,'image/jpeg',randomUUID()),201);
      expectStatus(await upload(fresh,2,png,'image/png',randomUUID()),201);
      expectStatus(await request('PUT','/submissions/'+fresh+'/fields',{auth:encoder,...resultKey(),json:{fields}}),200);
      const done=expectStatus(await request('POST','/submissions/'+fresh+'/complete',{auth:encoder,...resultKey()}),200);
      const claim=expectStatus(await request('POST','/submissions/'+fresh+'/review/claim',{auth:verifier,...resultKey(),revision:done.headers.get('ETag')!}),200);
      const path='/submissions/'+fresh+'/review/'+decision;
      expectStatus(await request('POST',path,{auth:verifier,...resultKey(),revision:claim.headers.get('ETag')!,json:{notes:' '}}),400);
      expectStatus(await request('POST',path,{auth:verifier,...resultKey(),revision:claim.headers.get('ETag')!,json:{notes:'Fictional fixture review.'}}),200);
      const result=expectStatus(await request('GET','/submissions/'+fresh+'/status',{auth:encoder}),200).data;
      assert.equal(result.status,decision==='return'?'NEEDS_CORRECTION':'REJECTED');
      assert.equal(result.decision.notes,'Fictional fixture review.');
      expectStatus(await upload(fresh,2,png,'image/png',randomUUID(),randomUUID()),409);
    }
  });
  await t.test('P21-08 SSS required sheet and mapped active controls are enforced',async()=>{
    const id=expectStatus(await request('POST','/submissions',{auth:encoder,...resultKey(),json:{...createBody,
      clientSubmissionId:randomUUID(),templateId:sssTemplate.id}}),201).data.id;
    const draft=newFixedDraft(randomUUID(),'');
    Object.assign(draft.values,{sss_registrant_last_name:'ALVAREZ',sss_registrant_first_name:'MIRA',sss_birth_date:'1994-04-15',
      sss_sex:'Female',sss_civil_status:'Single',sss_nationality:'FILIPINO',sss_place_of_birth:'PASIG',
      sss_employment_section:'Not applicable',sss_certification_review:'Reviewed on image',sss_additional_sheet_used:'Yes',
      sss_additional_registrant_last_name:'ALVAREZ',sss_additional_registrant_first_name:'MIRA',sss_additional_certification_review:'Reviewed on image'});
    const values=activeFixedFields(draft).map(f=>({key:f.id,mobileValue:draft.values[f.id],confirmed:true,ocr:null}));
    expectStatus(await upload(id,2,png,'image/png',randomUUID(),randomUUID()),422,'INVALID_PAGE_SLOT');
    expectStatus(await upload(id,1,jpeg,'image/jpeg',randomUUID(),randomUUID()),201);
    expectStatus(await request('PUT','/submissions/'+id+'/fields',{auth:encoder,...resultKey(),json:{fields:values}}),409,'INCOMPLETE_PAGES');
    expectStatus(await upload(id,3,png,'image/png',randomUUID(),randomUUID()),201);
    expectStatus(await request('PUT','/submissions/'+id+'/fields',{auth:encoder,...resultKey(),json:{fields:values}}),200);
    expectStatus(await request('POST','/submissions/'+id+'/complete',{auth:encoder,...resultKey()}),200);
    const status=expectStatus(await request('GET','/submissions/'+id+'/status',{auth:encoder}),200).data;
    assert.deepEqual(status.pages.map((p:{pageNumber:number})=>p.pageNumber),[1,3]);
    assert.equal(expectStatus(await request('GET','/submissions?limit=1',{auth:encoder}),200).data.nextOffset,1);
  });
  await t.test('P21-09 browser refresh rules, account revocation and expiry/retention',async()=>{
    const secured={'X-Forwarded-Proto':'https',Origin:'https://portal.tala.test'};
    expectStatus(await request('POST','/auth/login',{json:{email:emails.encoder,password,mode:'browser'}}),403);
    const browser=expectStatus(await request('POST','/auth/login',{headers:secured,json:{email:emails.encoder,password,mode:'browser'}}),200);
    const cookie=browser.headers.get('Set-Cookie')!;
    assert.match(cookie,/HttpOnly/);assert.match(cookie,/Secure/);
    assert.equal(browser.data.refreshToken,undefined);
    const accessHash=createHash('sha256').update(browser.data.accessToken).digest('hex');
    await pool.query("UPDATE sessions SET access_expires_at=now()-interval '1 sec',refresh_expires_at=now()+interval '1 min' WHERE access_hash=$1",[accessHash]);
    expectStatus(await request('GET','/auth/me',{auth:browser.data.accessToken}),401);
    const refreshed=expectStatus(await request('POST','/auth/refresh',{headers:{...secured,Cookie:cookie.split(';')[0]},json:{}}),200);
    assert.equal(refreshed.data.refreshToken,undefined);
    assert(refreshed.data.expiresIn>0 && refreshed.data.expiresIn<=60);
    expectStatus(await request('PATCH','/admin/users/'+otherId,{auth:encoder,json:{active:false}}),403);
    expectStatus(await request('PATCH','/admin/users/'+otherId,{auth:admin,json:{active:false}}),200);
    expectStatus(await request('GET','/auth/me',{auth:other}),401);
    const incomplete=expectStatus(await create(),201).data.id;
    expectStatus(await upload(incomplete,1,jpeg,'image/jpeg',randomUUID()),201);
    const key=(await pool.query('SELECT object_key FROM document_pages WHERE submission_id=$1',[incomplete])).rows[0].object_key;
    await pool.query("UPDATE submissions SET updated_at=now()-interval '40 days' WHERE id=$1",[incomplete]);
    const old=new Date(Date.now()-172_800_000);
    await utimes(join(cfg.STORAGE_ROOT,key),old,old);
    assert.equal((await maintenance(pool,disk,30,false)).incompleteDrafts,1);
    assert.equal((await maintenance(pool,disk,30,true)).incompleteDrafts,1);
    await assert.rejects(disk.read(key));
    assert.equal(expectStatus(await request('GET','/submissions/'+incomplete+'/status',{auth:encoder}),200).data.status,'EXPIRED');
    expectStatus(await request('POST','/auth/logout',{json:{refreshToken:encRefresh}}),204);
    expectStatus(await request('GET','/auth/me',{auth:encoder}),401);
    assert.deepEqual(testErrors,[]);
  });
});
