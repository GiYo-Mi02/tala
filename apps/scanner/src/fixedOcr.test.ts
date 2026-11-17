import {describe,it,expect,vi,beforeEach} from 'vitest';
import {sssTemplate,newFixedDraft,type FixedPage} from '@tala/core';
const mock=vi.hoisted(()=>vi.fn());
vi.mock('expo-crypto',()=>({randomUUID:()=> 'fixed-run'}));
vi.mock('../modules/tala-ocr',()=>({default:{recognizeField:mock,diagnosticsEnabled:true}}));
vi.mock('./repository',()=>({discardCache:vi.fn(async()=>{})}));
import {recognizeFixedPage,fixedReading} from './fixedOcr';
import type {RoiResult} from '../modules/tala-ocr';
const page:FixedPage={page:1,imageId:'new-image',uri:'file:///private/sss.jpg',width:1600,height:2071,acceptedAt:'now',
  alignment:{method:'opencv-manual-v1',sourceWidth:1600,sourceHeight:2071,corners:[{x:0,y:0},{x:1,y:0},{x:1,y:1},{x:0,y:1}]}};
function result(id:string,before:string,after=before):RoiResult {
  const reading=(text:string)=>({text,readingText:text,confidence:.7,elements:[]});
  return {fieldId:id,part:0,x:10,y:10,sourceWidth:100,sourceHeight:20,inputWidth:300,inputHeight:116,
    original:reading(before),processed:reading(after),verticalLines:[],horizontalLines:[],occupiedCells:[],removedInkFraction:0,diagnostics:{}};
}
beforeEach(()=>{mock.mockReset();mock.mockImplementation(async(_uri,json)=>result(JSON.parse(json).fieldId,''));});
describe('SSS native ROI orchestration',()=>{
  it('sends the selected template ID, fixed field ID and pixel region; never reads manual checkbox controls',async()=>{
    const {run}=await recognizeFixedPage(newFixedDraft('draft','now'),page,()=>{});
    expect(Object.keys(run.fields)).toHaveLength(sssTemplate.fields.filter(f=>f.page===1&&f.mode==='ocr').length);
    for(const [uri,json] of mock.mock.calls){
      const request=JSON.parse(json);expect(uri).toBe(page.uri);expect(request.templateId).toBe(sssTemplate.id);
      expect(sssTemplate.fields.find(f=>f.id===request.fieldId)?.mode).toBe('ocr');
      expect(request.width).toBeGreaterThan(0);expect(request.height).toBeGreaterThan(0);
    }
    expect(run.pageImageId).toBe(page.imageId);expect(run.templateVersion).toBe(1);
    expect(run.fields.sss_sex).toBeUndefined();expect(run.fields.sss_registrant_last_name.pageImageId).toBe(page.imageId);
  });
  it('blocks reference-only pages and a crop with the wrong paper proportions',async()=>{
    await expect(recognizeFixedPage(newFixedDraft('draft','now'),{...page,page:2},()=>{})).rejects.toThrow(/Align/);
    await expect(recognizeFixedPage(newFixedDraft('draft','now'),{...page,width:1600,height:2263},()=>{})).rejects.toThrow(/proportions/);
  });
  it('keeps both identity alternatives and leaves different valid names unresolved',()=>{
    const f=sssTemplate.fields.find(f=>f.id==='sss_registrant_last_name')!;
    const r=fixedReading(f,result(f.id,'ALVAREZ','ALVARES'),page.imageId,f.region!);
    expect(r.normalized).toBe('');expect(r.warning).toMatch(/disagree/);expect(r.originalText).toBe('ALVAREZ');expect(r.processedText).toBe('ALVARES');
  });
  it('does not substitute digits into uncertain SS numbers or dates',()=>{
    const f=sssTemplate.fields.find(f=>f.id==='sss_ss_number')!;
    const r=fixedReading(f,result(f.id,'OO12345678'),page.imageId,f.region!);
    expect(r.normalized).toBe('OO12345678');expect(r.error).toMatch(/digits/);
  });
  it('uses an actual grouped-digit reading when row OCR omits a digit, with an explicit review warning',()=>{
    const f=sssTemplate.fields.find(f=>f.id==='sss_tin')!;
    const r=result(f.id,'OO1234567','01234567');r.segmented={text:'001 234 567',readingText:'001 234 567',confidence:.9,elements:[]};
    const actual=fixedReading(f,r,page.imageId,f.region!);
    expect(actual.normalized).toBe('001234567');expect(actual.segmentedText).toBe('001 234 567');expect(actual.warning).toMatch(/uncertain/);
    expect(actual.originalText).toBe('OO1234567');
  });
  it('does not fill an optional empty identity field when a grouped candidate conflicts with empty row readings',()=>{
    const f=sssTemplate.fields.find(f=>f.id==='sss_tin')!;
    const r=result(f.id,'');r.segmented={text:'111 111 111',readingText:'111 111 111',confidence:.6,elements:[]};
    expect(fixedReading(f,r,page.imageId,f.region!).normalized).toBe('');
  });
  it('keeps other crops on an isolated native failure and never leaks exception paths into history',async()=>{
    mock.mockImplementation(async(_uri,json)=>{const id=JSON.parse(json).fieldId;if(id==='sss_registrant_first_name')throw new Error('private filesystem path');return result(id,'');});
    const {run}=await recognizeFixedPage(newFixedDraft('draft','now'),page,()=>{});
    expect(run.fields.sss_registrant_first_name.error).toBeTruthy();expect(run.fields.sss_registrant_last_name.error).toBeTruthy();
    expect(JSON.stringify(run)).not.toContain('private filesystem');
  });
});
