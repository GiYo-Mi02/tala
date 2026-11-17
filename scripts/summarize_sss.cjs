// Replay actual native readings through the same field policy used by the app.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),esbuild=require('esbuild');
async function main(){
  const root=path.resolve(__dirname,'..');process.chdir(root);
  await esbuild.build({entryPoints:['apps/scanner/src/fixedOcr.ts'],outfile:'.cache/sss-replay.cjs',bundle:true,platform:'node',plugins:[{name:'offline-native-replay',setup(build){
    build.onResolve({filter:/^expo-crypto$/},()=>({path:'crypto',namespace:'stub'}));
    build.onResolve({filter:/modules\/tala-ocr$/},()=>({path:'native',namespace:'stub'}));
    build.onResolve({filter:/^\.\/repository$/},()=>({path:'repository',namespace:'stub'}));
    build.onLoad({filter:/.*/,namespace:'stub'},args=>({contents:args.path==='crypto'?'export const randomUUID=()=>"evidence";':args.path==='repository'?'export const discardCache=async()=>{};':'export default {};'}));
  }}]});
  const {fixedReading}=require(path.join(root,'.cache/sss-replay.cjs'));
  const spec=JSON.parse(fs.readFileSync('packages/core/src/sss-e1.json','utf8'));
  const native=JSON.parse(fs.readFileSync(process.argv[2]??'docs/evidence/sss/native-comparison.json','utf8'));
  const rows=native.map(row=>{
    const field=spec.fields.find(f=>f.id===row.fieldId),r=row.result;
    const actual=fixedReading(field,r,`${row.case}-page-${row.page}`,{x:r.x/row.width,y:r.y/row.height,width:r.sourceWidth/row.width,height:r.sourceHeight/row.height});
    return {case:row.case,page:row.page,fieldId:row.fieldId,label:field.label,expected:row.expected,actual:actual.normalized,
      status:actual.normalized===row.expected?'correct':actual.normalized===''?'missing':'incorrect',
      original:actual.originalText,processed:actual.processedText,confidence:actual.confidence,warning:actual.warning??null,validation:actual.error??null};
  });
  const summaries=[...new Set(rows.map(r=>r.case))].map(name=>{
    const group=rows.filter(r=>r.case===name),filled=group.filter(r=>r.expected!=='');
    return {case:name,comparisons:group.length,correct:group.filter(r=>r.status==='correct').length,missing:group.filter(r=>r.status==='missing').length,
      incorrect:group.filter(r=>r.status==='incorrect').length,nonemptyExpected:filled.length,nonemptyCorrect:filled.filter(r=>r.status==='correct').length,
      blankExpected:group.length-filled.length,blankCorrect:group.filter(r=>r.expected===''&&r.actual==='').length};
  });
  const fixtures=fs.readdirSync('fixtures/sss').filter(f=>f.endsWith('.png')).map(file=>({file,sha256:crypto.createHash('sha256').update(fs.readFileSync(`fixtures/sss/${file}`)).digest('hex')}));
  fs.writeFileSync(process.argv[3]??'docs/evidence/sss/field-results.json',JSON.stringify({templateId:spec.id,templateVersion:spec.version,engine:'mlkit-bundled-latin-16.0.1',
    scope:'Actual offline emulator recognition on unchanged fictional digital E-1 fixtures. Manual controls are excluded from OCR scores. Physical phone accuracy is not established.',summaries,fixtures,fields:rows},null,2)+'\n');
  summaries.forEach(r=>console.log(JSON.stringify(r)));
  for(const r of rows.filter(r=>r.status!=='correct'))console.log(`${r.case} / ${r.fieldId}: ${JSON.stringify(r.expected)} => ${JSON.stringify(r.actual)} (${r.status})`);
}
main().catch(error=>{console.error(error);process.exitCode=1;});
