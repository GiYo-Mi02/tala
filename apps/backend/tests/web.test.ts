import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash, randomBytes, randomUUID, X509Certificate } from 'node:crypto';
import { once } from 'node:events';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createServer } from 'node:https';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { promisify } from 'node:util';
import { chromium, type Page } from 'playwright';
import sharp from 'sharp';
import { activeFixedFields, newFixedDraft, newDraft, fieldKeys, type RawField, type OcrRun } from '@tala/core';
import { makeSyncSnapshot } from '../../scanner/src/syncSnapshot';
import { createApp } from '../src/app';
import { provision } from '../src/auth';
import { config } from '../src/config';
import { connect, migrate } from '../src/db';
import { checksum, PrivateDiskStore } from '../src/storage';
import { seedTemplates } from '../src/templates';

const execute=promisify(execFile);

test('P23-01 built verifier portal over HTTPS with private scans and an isolated PostgreSQL database', {timeout:120000}, async t=>{
  assert.equal(process.env.TALA_ISOLATED_TEST_CLUSTER,'1');
  const database=new URL(process.env.TALA_TEST_DATABASE_URL!);
  assert.equal(database.hostname,'127.0.0.1');
  assert.equal(database.username,'tala_test');
  const bootstrap=connect(database.href);
  try { await bootstrap.query('CREATE DATABASE tala_web_test'); }
  finally { await bootstrap.end(); }
  database.pathname='/tala_web_test';
  await migrate(database.href);
  const pool=connect(database.href);
  t.after(()=>pool.end());
  await seedTemplates(pool);

  const work=join(process.env.TALA_TEST_STORAGE!,'..','web-qa');
  await mkdir(work,{recursive:true});
  const root=join(work,'dist');
  await cp(resolve('../web/dist'),root,{recursive:true});
  const store=new PrivateDiskStore(join(work,'images'));
  const key=join(work,'test-key.pem'), cert=join(work,'test-cert.pem');
  const opensslConfig=join(work,'openssl.cnf');
  await writeFile(opensslConfig,'[req]\ndistinguished_name=dn\n[dn]\ncommonName=localhost\n');
  const openssl=process.env.TALA_TEST_OPENSSL??(process.platform==='win32'?'C:/Program Files/Git/mingw64/bin/openssl.exe':'openssl');
  await execute(openssl,['req','-config',opensslConfig,'-newkey','rsa:2048','-sha256','-nodes','-x509','-days','1','-subj','/CN=localhost',
    '-addext','subjectAltName=IP:127.0.0.1,DNS:localhost','-keyout',key,'-out',cert],{windowsHide:true});
  const certificate=await readFile(cert);
  const certificatePin=createHash('sha256').update(new X509Certificate(certificate).publicKey.export({type:'spki',format:'der'})).digest('base64');

  let app:ReturnType<typeof createApp>;
  let failOverview=false;
  const web=createServer({cert:certificate,key:await readFile(key)},(req,res)=>{
    if(failOverview&&req.url==='/api/v1/submissions/overview') {
      failOverview=false;
      res.writeHead(503,{'Content-Type':'application/json','Cache-Control':'no-store'});
      res.end(JSON.stringify({error:{code:'DATABASE_UNAVAILABLE',message:'The test database is temporarily unavailable.'}}));
      return;
    }
    app(req,res);
  }).listen(0,'127.0.0.1');
  await once(web,'listening');
  t.after(()=>new Promise<void>(resolve=>{web.close(()=>resolve());web.closeAllConnections();}));
  const address=web.address();
  if(!address||typeof address==='string')throw new Error('HTTPS test listener unavailable');
  const origin='https://127.0.0.1:'+address.port;
  app=createApp(pool,store,config({DATABASE_URL:database.href,STORAGE_ROOT:join(work,'images'),NODE_ENV:'test',
    WEB_ROOT:root,CORS_ORIGINS:origin,RATE_LIMIT:'1000'}));
  const native=app.listen(0,'127.0.0.1');
  await once(native,'listening');
  t.after(()=>new Promise<void>(resolve=>{native.close(()=>resolve());native.closeAllConnections();}));
  const nativeAddress=native.address();
  if(!nativeAddress||typeof nativeAddress==='string')throw new Error('Native test listener unavailable');
  const api='http://127.0.0.1:'+nativeAddress.port+'/api/v1';
  const password=randomBytes(24).toString('hex');
  const verifier=await provision(pool,{email:'verifier@example.test',password,role:'VERIFIER'},null);
  const encoder=await provision(pool,{email:'encoder@example.test',password,role:'ENCODER'},null);
  const other=await provision(pool,{email:'other@example.test',password,role:'ENCODER'},null);

  const windowsBrowser='C:/Program Files/Google/Chrome/Application/chrome.exe';
  const executablePath=process.env.TALA_TEST_BROWSER??(process.platform==='win32'&&existsSync(windowsBrowser)?windowsBrowser:undefined);
  const browser=await chromium.launch({executablePath,headless:true,
    args:['--ignore-certificate-errors-spki-list='+certificatePin]});
  t.after(()=>browser.close());
  const context=await browser.newContext({viewport:{width:1440,height:960},serviceWorkers:'allow'});
  context.setDefaultTimeout(12000);
  const page=await context.newPage();
  const failures:string[]=[];
  page.on('pageerror',error=>failures.push(error.message));
  async function login(view:Page,email:string) {
    await view.getByLabel('Email address').fill(email);
    await view.getByLabel('Password',{exact:true}).fill(password);
    await view.getByRole('button',{name:'Sign in',exact:true}).click();
  }
  const waitText=(view:Page,value:string)=>view.getByText(value,{exact:true}).first().waitFor();
  const heading=(view:Page,name:string)=>view.getByRole('heading',{name,exact:true}).waitFor();
  await page.goto(origin+'/submissions');
  await heading(page,'Sign in');
  await login(page,verifier.email);
  await heading(page,'Submissions');
  await heading(page,'No matching submissions');
  await page.getByRole('link',{name:'Dashboard',exact:true}).click();
  await heading(page,'No submissions yet');
  assert.equal(await page.locator('.metric').first().locator('strong').textContent(),'0');
  const cookie=(await context.cookies()).find(c=>c.name==='__Secure-tala-refresh');
  assert(cookie?.secure&&cookie.httpOnly&&cookie.sameSite==='Strict');

  const restricted=await browser.newContext();
  const restrictedPage=await restricted.newPage();
  await restrictedPage.goto(origin+'/login');
  await login(restrictedPage,other.email);
  await heading(restrictedPage,'Access restricted');
  await restrictedPage.goto(origin+'/submissions');
  await heading(restrictedPage,'Access restricted');
  await restricted.close();
  t.diagnostic('Verifier and restricted-account browser sessions passed.');

  async function send(method:string,path:string,token?:string,value?:object|Buffer,headers:HeadersInit={}) {
    return fetch(api+path,{method,headers:{
      ...headers,...(token?{Authorization:'Bearer '+token}:{}),
      ...(value&&!Buffer.isBuffer(value)?{'Content-Type':'application/json'}:{}),
    },body:Buffer.isBuffer(value)?Uint8Array.from(value):value?JSON.stringify(value):undefined});
  }
  async function nativeToken(email:string) {
    const response=await send('POST','/auth/login',undefined,{email,password});
    assert.equal(response.status,200);
    return (await response.json()).accessToken as string;
  }
  const uploadToken=await nativeToken(encoder.email);
  const reviewerToken=await nativeToken(verifier.email);
  const otherToken=await nativeToken(other.email);
  assert.equal((await send('GET','/submissions/overview',otherToken)).status,403);
  assert.equal((await send('GET','/submissions/overview')).status,401);

  const scans=await Promise.all([1,2].map(async number=>{
    const bytes=await readFile(resolve('../../fixtures/images/clean-page-'+number+'.png'));
    const image=sharp(bytes);
    const {width,height}=await image.metadata();
    return width&&height&&width>height?image.rotate(90).png().toBuffer():bytes;
  }));
  const small=await sharp({create:{width:110,height:155,channels:3,background:'#e5ede1'}}).png().toBuffer();
  const time=new Date().toISOString();
  const makePage=(page:1|2)=>({page,imageId:randomUUID(),uri:'file:///test/'+page+'.jpg',width:110,height:155,acceptedAt:time});
  const ids:string[]=[];
  const keys=()=>({'Idempotency-Key':randomUUID()});
  async function synchronize(snapshot:ReturnType<typeof makeSyncSnapshot>,pictures:Buffer[]) {
    const start=await send('POST','/submissions',uploadToken,snapshot.create,keys());
    assert.equal(start.status,201);
    const {id}=await start.json();
    for(const [index,scan] of snapshot.pages.entries()) {
      const bytes=pictures[index];
      const upload=await send('PUT','/submissions/'+id+'/pages/'+scan.number,uploadToken,bytes,{
        ...keys(),'Content-Type':'image/png','X-Image-Id':scan.imageId,'X-Content-SHA256':checksum(bytes),
      });
      assert.equal(upload.status,201,await upload.text());
    }
    const fields=await send('PUT','/submissions/'+id+'/fields',uploadToken,snapshot.fields,keys());
    assert.equal(fields.status,200,await fields.text());
    const complete=await send('POST','/submissions/'+id+'/complete',uploadToken,{},keys());
    assert.equal(complete.status,200,await complete.text());
    return id as string;
  }
  for(let i=0;i<11;i++) {
    const draft=newDraft(randomUUID(),time);
    draft.pages={1:makePage(1),2:makePage(2)};
    draft.values={school_year:'2024-2025',grade_level:'7',lrn:'001234567890',learner_first_name:'ELENA',
      learner_last_name:'RIVERA',learner_middle_name:'',birth_date:'2012-02-29'};
    draft.confirmed=Object.fromEntries(fieldKeys.map(key=>[key,true]));
    const box={x:.57,y:.18,width:.22,height:.02};
    const raw=Object.fromEntries<RawField>(fieldKeys.map(key=>[key,{crop:box,regions:[box],
      elements:[],text:key==='lrn'?'OO123456789O':draft.values[key]}])) as OcrRun['fields'];
    raw.lrn.readingText='OO123456789O';
    raw.lrn.warning='preprocessing_review';
    raw.lrn.evidence=[{originalText:'OO123456789O',originalReading:'OO123456789O',originalConfidence:.71,
      processedText:'001234567890',processedReading:'001234567890',processedConfidence:.82,
      sourceWidth:180,sourceHeight:30,inputWidth:180,inputHeight:30,verticalLines:[],horizontalLines:[],
      occupiedCells:[],removedInkFraction:0}];
    draft.ocrHistory=[{id:randomUUID(),pageImageId:draft.pages[1]!.imageId,at:time,engine:'mlkit-bundled-latin-16.0.1',fields:raw}];
    draft.state='ready';
    ids.push(await synchronize(makeSyncSnapshot(draft),i===0?scans:[small,small]));
  }
  const fixed=newFixedDraft(randomUUID(),time);
  Object.assign(fixed.values,{sss_registrant_last_name:'ALVAREZ',sss_registrant_first_name:'MIRA',sss_birth_date:'1994-04-15',
    sss_sex:'Female',sss_civil_status:'Single',sss_nationality:'FILIPINO',sss_place_of_birth:'PASIG',
    sss_employment_section:'Not applicable',sss_certification_review:'Reviewed on image',sss_additional_sheet_used:'No'});
  fixed.pages[1]={...makePage(1),alignment:{} as NonNullable<typeof fixed.pages[1]>['alignment']};
  fixed.confirmed=Object.fromEntries(activeFixedFields(fixed).map(field=>[field.id,true]));
  fixed.state='ready';
  const sss=await synchronize(makeSyncSnapshot(fixed),[small]);
  const claimed=ids[1];
  const record=await send('GET','/submissions/'+claimed,reviewerToken);
  const claim=await send('POST','/submissions/'+claimed+'/review/claim',reviewerToken,{},
    {...keys(),'If-Match':record.headers.get('ETag')!});
  assert.equal(claim.status,200);
  const identitySearch=await send('GET','/submissions?q=RIVERA',reviewerToken);
  assert.equal(identitySearch.status,200);
  assert.deepEqual((await identitySearch.json()).items,[]);
  assert.equal((await send('GET','/submissions?from=2026-08-02&to=2026-08-01',reviewerToken)).status,400);
  await pool.query("UPDATE template_fields SET rules=jsonb_set(rules,'{type}','\"future_enum\"') WHERE field_key='lrn'");
  const readOnlyBaseline=await pool.query('SELECT id,status,revision,updated_at FROM submissions ORDER BY id');

  await page.getByRole('button',{name:'Refresh',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('.metric strong')?.textContent==='12');
  assert.deepEqual(await page.locator('.metric strong').allTextContents(),['12','11','1','0']);
  await page.screenshot({path:join(work,'dashboard.png')});
  failOverview=true;
  await page.getByRole('button',{name:'Refresh',exact:true}).click();
  await heading(page,'Could not load this information');
  await page.getByRole('button',{name:'Try again',exact:true}).click();
  await heading(page,'Recent submissions');
  t.diagnostic('Live dashboard counts, empty state, and failed-request recovery passed.');
  await page.getByRole('link',{name:'View submissions'}).click();
  await waitText(page,'Showing 1–10');
  await page.getByRole('button',{name:'Next',exact:true}).click();
  await waitText(page,'Showing 11–12');
  await page.getByRole('button',{name:'Previous',exact:true}).click();
  await waitText(page,'Showing 1–10');
  await page.getByLabel('Sort by',{exact:true}).selectOption('oldest');
  await page.getByRole('button',{name:'Apply filters'}).click();
  await page.waitForFunction(expected=>document.querySelector('.submission-table tbody a')?.getAttribute('href')===expected,'/submissions/'+ids[0]);
  await page.getByLabel('Verification status',{exact:true}).selectOption('IN_REVIEW');
  await page.getByRole('button',{name:'Apply filters'}).click();
  await page.getByRole('link',{name:'Open submission '+claimed}).waitFor();
  await page.getByRole('button',{name:'Clear',exact:true}).click();
  await page.getByLabel('Document template',{exact:true}).selectOption(fixed.templateId);
  await page.getByRole('button',{name:'Apply filters'}).click();
  await page.getByRole('link',{name:'Open submission '+sss}).waitFor();
  await waitText(page,'Showing 1–1');
  await page.getByRole('link',{name:'Open submission '+sss}).click();
  await waitText(page,'ALVAREZ');
  await page.getByRole('img',{name:'Original scan, page 1'}).waitFor();
  await page.getByRole('button',{name:'Next page'}).isDisabled().then(value=>assert(value));
  await page.getByRole('link',{name:'Back to submissions'}).click();
  await page.getByLabel('Document template',{exact:true}).selectOption(fixed.templateId);
  await page.getByLabel('Received through (UTC)').fill('2020-01-01');
  await page.getByRole('button',{name:'Apply filters'}).click();
  await heading(page,'No matching submissions');
  await page.getByRole('button',{name:'Clear',exact:true}).click();
  t.diagnostic('Server pagination, sorting, status, template and date filters passed.');

  await page.getByLabel('Search by reference or document').fill(ids[0].slice(0,12));
  await page.getByRole('button',{name:'Apply filters'}).click();
  await waitText(page,'Showing 1–1');
  await page.getByRole('link',{name:'Open submission '+ids[0]}).click();
  await heading(page,'Extracted information');
  await waitText(page,'001234567890');
  await waitText(page,'OO123456789O');
  await waitText(page,'OCR 71%');
  await waitText(page,'Image processing changed the OCR reading. Check the scan.');
  await heading(page,'Enrollment information');
  await waitText(page,'Empty');
  await page.getByRole('img',{name:'Original scan, page 1'}).waitFor();
  await page.screenshot({path:join(work,'review.png')});
  await page.getByRole('button',{name:'Zoom in'}).click();
  await waitText(page,'125%');
  await page.getByRole('button',{name:'Fit to screen'}).click();
  await waitText(page,'100%');
  await page.getByRole('button',{name:'Rotate clockwise'}).click();
  assert.match(await page.getByRole('img',{name:'Original scan, page 1'}).getAttribute('style')??'',/rotate\(90deg\)/);
  await page.getByRole('button',{name:'Next page'}).click();
  await page.getByRole('img',{name:'Original scan, page 2'}).waitFor();
  t.diagnostic('Original stored scans, evidence mapping and unavailable-image recovery passed.');
  const path='/submissions/'+ids[0]+'/pages/1';
  assert.equal((await send('GET',path)).status,401);
  assert.equal((await send('GET',path,otherToken)).status,404);
  assert.deepEqual(Buffer.from(await (await send('GET',path,reviewerToken)).arrayBuffer()),scans[0]);

  const privatePage=(await pool.query('SELECT object_key FROM document_pages WHERE submission_id=$1 AND page_number=2',[ids[0]])).rows[0].object_key;
  await store.remove(privatePage);
  await page.getByRole('button',{name:'Previous page'}).click();
  await page.getByRole('button',{name:'Next page'}).click();
  await heading(page,'Scan unavailable');
  await store.put(privatePage,scans[1]);
  await page.getByRole('button',{name:'Try again',exact:true}).click();
  await page.getByRole('img',{name:'Original scan, page 2'}).waitFor();

  for (const size of [{width:1280,height:800},{width:768,height:1024}]) {
    await page.setViewportSize(size);
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  }
  await page.setViewportSize({width:390,height:850});
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  const viewer=await page.getByRole('region',{name:'Document image viewport'}).boundingBox();
  const panel=await page.getByRole('heading',{name:'Extracted information'}).boundingBox();
  assert(viewer&&panel&&panel.y>viewer.y);
  await page.getByRole('button',{name:'Open navigation'}).click();
  await page.getByRole('navigation',{name:'Main navigation'}).waitFor();
  await page.keyboard.press('Escape');
  await page.getByRole('navigation',{name:'Main navigation'}).waitFor({state:'hidden'});
  await page.screenshot({path:join(work,'review-mobile.png')});
  await page.setViewportSize({width:1440,height:960});

  await page.waitForFunction(()=>navigator.serviceWorker.controller!==null);
  const pwa=await page.evaluate(async()=>{
    const manifest=await fetch('/manifest.webmanifest').then(r=>r.json());
    const entries=(await Promise.all((await caches.keys()).map(async key=>(await (await caches.open(key)).keys()).map(req=>new URL(req.url).pathname)))).flat();
    return {manifest,entries};
  });
  assert.equal(pwa.manifest.display,'standalone');
  assert(pwa.manifest.icons.some((icon:{sizes:string})=>icon.sizes==='192x192'));
  for(const entry of pwa.entries) assert.match(entry,/^\/(index\.html|icon-(192|512|maskable)\.png|manifest\.webmanifest|assets\/)/);
  assert(pwa.entries.includes('/index.html'));
  assert(!pwa.entries.some(path=>path.startsWith('/api')||path.includes('submissions')));
  const workerPath=join(root,'sw.js');
  await writeFile(workerPath,(await readFile(workerPath,'utf8'))+'\n// Test alternate shell worker version.\n');
  await page.evaluate(async()=>{await (await navigator.serviceWorker.getRegistration())?.update();});
  await page.getByRole('button',{name:'Reload portal'}).waitFor();
  await Promise.all([page.waitForEvent('load'),page.getByRole('button',{name:'Reload portal'}).click()]);
  await heading(page,'Extracted information');
  await context.setOffline(true);
  await page.reload({waitUntil:'domcontentloaded'});
  await heading(page,'Connection unavailable');
  assert.equal(await page.getByText('001234567890',{exact:true}).count(),0);
  await context.setOffline(false);
  await heading(page,'Extracted information');
  t.diagnostic('Responsive review, public-only PWA cache, update and offline shell passed.');

  await page.getByRole('link',{name:'Dashboard',exact:true}).click();
  await heading(page,'Verification dashboard');
  const previous=(await context.cookies()).find(c=>c.name==='__Secure-tala-refresh')?.value;
  await pool.query("UPDATE sessions SET access_expires_at=now()-interval '1 sec' WHERE user_id=$1 AND mode='browser'",[verifier.id]);
  const rotation=page.waitForResponse(response=>response.url().endsWith('/api/v1/auth/refresh')&&response.status()===200);
  await page.getByRole('button',{name:'Refresh',exact:true}).click();
  await rotation;
  await page.waitForFunction(()=>document.querySelector('.metric strong')?.textContent==='12');
  const refreshed=(await context.cookies()).find(c=>c.name==='__Secure-tala-refresh')?.value;
  assert(refreshed&&previous&&refreshed!==previous);
  await pool.query("UPDATE sessions SET access_expires_at=now()-interval '1 sec',refresh_expires_at=now()-interval '1 sec' WHERE user_id=$1 AND mode='browser'",[verifier.id]);
  await page.getByRole('button',{name:'Refresh',exact:true}).click();
  await heading(page,'Session expired');
  await page.getByRole('link',{name:'Return to sign-in'}).click();
  await login(page,verifier.email);
  await heading(page,'Verification dashboard');
  await page.getByRole('link',{name:'Document review',exact:true}).click();
  await heading(page,'Choose a submission');
  await page.goto(origin+'/unrecognized-route');
  await heading(page,'Page not found');
  await page.getByRole('button',{name:'Sign out',exact:true}).click();
  await heading(page,'Sign in');
  assert(!(await context.cookies()).some(c=>c.name==='__Secure-tala-refresh'));
  assert.deepEqual((await pool.query('SELECT id,status,revision,updated_at FROM submissions ORDER BY id')).rows,readOnlyBaseline.rows);
  assert.deepEqual(failures,[]);
});
