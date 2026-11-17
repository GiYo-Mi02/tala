import {describe,it,expect,vi} from 'vitest';
import clean from '../../../fixtures/sss/sss-clean.json';
import additional from '../../../fixtures/sss/sss-additional.json';
import beneficiaries from '../../../fixtures/sss/sss-beneficiaries.json';
import nws from '../../../fixtures/sss/sss-nws.json';
import invalid from '../../../fixtures/sss/sss-invalid.json';
import {sssTemplate,fixedTemplate,newFixedDraft,activeFixedFields,fixedErrors,fixedReadiness,normalizeFixed,fixedFieldError,fixedWithPage,saveFixed,acceptFixedPage,
  type FixedDraft,type FixedPage,type FixedPort,type FixedRun} from './fixed-forms';
const field=(id:string)=>sssTemplate.fields.find(f=>f.id===id)!;
const page:FixedPage={page:1,imageId:'image-1',uri:'file:///cache/incoming.jpg',width:1600,height:2071,acceptedAt:'now',
  alignment:{method:'opencv-manual-v1',sourceWidth:1600,sourceHeight:2071,corners:[{x:0,y:0},{x:1,y:0},{x:1,y:1},{x:0,y:1}]}};
const run:FixedRun={id:'run-1',page:1,pageImageId:page.imageId,at:'now',templateId:sssTemplate.id,templateVersion:1,engine:'mlkit-bundled-latin-16.0.1',preprocessing:'native-roi-v3',fields:{}};
function complete(fixture=clean):FixedDraft {
  const draft={...newFixedDraft('fixture','now'),values:fixture.values,pages:{1:page}};
  return {...draft,confirmed:Object.fromEntries(activeFixedFields(draft).map(f=>[f.id,true]))};
}
describe('SSS fixed template registry and source mapping',()=>{
  it('pins the actual revision and keeps instructions reference-only',()=>{
    expect(fixedTemplate(sssTemplate.id,1)).toBe(sssTemplate);
    expect(()=>fixedTemplate(sssTemplate.id,2)).toThrow(/Unsupported/);
    expect(sssTemplate.revision).toBe('COV-01214 (09-2015)');
    expect(sssTemplate.pages.map(p=>[p.number,p.capture,p.required])).toEqual([[1,true,true],[2,false,false],[3,true,false]]);
    expect(sssTemplate.fields).toHaveLength(136);
    expect(sssTemplate.fields.filter(f=>f.mode==='ocr')).toHaveLength(127);
  });
  it('maps every OCR field inside applicant sections and never into signature/fingerprint or SSS processing',()=>{
    expect(new Set(sssTemplate.fields.map(f=>f.id)).size).toBe(sssTemplate.fields.length);
    for(const f of sssTemplate.fields){
      expect(f.id).toMatch(/^sss_[a-z0-9_]+$/);
      if(f.mode==='manual'){expect(f.region).toBeUndefined();continue;}
      const r=f.region!;expect([1,3]).toContain(f.page);expect(r.x).toBeGreaterThanOrEqual(0);expect(r.y).toBeGreaterThan(0);
      expect(r.x+r.width).toBeLessThanOrEqual(1);expect(r.y+r.height).toBeLessThan(f.page===1?662/792:313/792);
      expect(r.height).toBeLessThan(.1);expect(r.width).toBeGreaterThan(0);
    }
  });
  it('gives all ten child rows and four other-beneficiary rows independent stable IDs',()=>{
    for(const prefix of ['child','additional_child'])for(let i=1;i<=5;i++)
      expect(sssTemplate.fields.filter(f=>f.row===`${prefix}_${i}`)).toHaveLength(5);
    for(const prefix of ['beneficiary','additional_beneficiary'])for(let i=1;i<=2;i++)
      expect(sssTemplate.fields.filter(f=>f.row===`${prefix}_${i}`)).toHaveLength(6);
    expect(field('sss_registrant_last_name').region).not.toEqual(field('sss_mother_last_name').region);
  });
});
describe('SSS field validation and local readiness',()=>{
  it.each([clean,additional,beneficiaries,nws])('validates independent fictional $case values',fixture=>{
    const draft={...newFixedDraft('fixture','now'),values:fixture.values};
    for(const f of sssTemplate.fields)expect(normalizeFixed(f,fixture.raw[f.id as keyof typeof fixture.raw]),f.id).toBe(fixture.values[f.id as keyof typeof fixture.values]);
    expect(fixedErrors(draft)).toEqual({});
  });
  it('rejects missing names, invalid dates and identifiers without repairing identity characters',()=>{
    const errors=fixedErrors({...newFixedDraft('fixture','now'),values:invalid.values});
    expect(Object.keys(errors)).toEqual(expect.arrayContaining(['sss_registrant_first_name','sss_birth_date','sss_ss_number','sss_email','sss_certification_review']));
    expect(normalizeFixed(field('sss_ss_number'),'OO12B45678')).toBe('OO12B45678');
    expect(fixedFieldError(field('sss_ss_number'),'OO12B45678')).toBeTruthy();
    expect(normalizeFixed(field('sss_birth_date'),'04151994')).toBe('1994-04-15');
    expect(fixedFieldError(field('sss_birth_date'),'1994-02-30')).toBeTruthy();
  });
  it('keeps optional blanks and SS-number leading zeroes',()=>{
    expect(normalizeFixed(field('sss_ss_number'),'00-1234567-8')).toBe('0012345678');
    expect(fixedFieldError(field('sss_spouse_birth_date'),'')).toBeUndefined();
    expect(fixedFieldError(field('sss_registrant_last_name'),'R|VERA')).toBeTruthy();
  });
  it('preserves intentional name spaces, hyphens and apostrophes during manual normalization',()=>{
    expect(normalizeFixed(field('sss_registrant_last_name'),"DE  LA CRUZ-O'NEILL")).toBe("DE  LA CRUZ-O'NEILL");
  });
  it('requires the additional photograph only when the user selects its checkbox',()=>{
    expect(fixedReadiness(complete())).toEqual([]);
    const extra={...complete(additional),values:additional.values};
    expect(fixedReadiness(extra)).toContain('Accept Additional dependents / beneficiaries.');
    expect(fixedReadiness({...extra,pages:{...extra.pages,3:{...page,page:3,imageId:'image-3'}}})).toEqual([]);
  });
  it('requires visual manual-box confirmation; stale page replacement clears affected confirmations',()=>{
    const draft=complete();expect(fixedReadiness({...draft,confirmed:{...draft.confirmed,sss_sex:false}})).not.toEqual([]);
    const changed=fixedWithPage(draft,{...page,imageId:'new-image'},undefined,false);
    expect(changed.confirmed.sss_sex).toBe(false);expect(changed.values).toEqual(draft.values);expect(changed.state).toBe('editing');
  });
  it('flags incomplete populated rows and different applicant identities across sheets without copying values',()=>{
    let draft={...newFixedDraft('fixture','now'),values:{...clean.values,sss_child_2_first_name:'NINA'}};
    expect(fixedErrors(draft).sss_child_2_last_name).toBeTruthy();
    const extra={...newFixedDraft('fixture','now'),values:{...additional.values,sss_additional_registrant_last_name:'TORRES'}};
    expect(fixedErrors(extra).sss_additional_registrant_last_name).toMatch(/differs/);
    expect(extra.values.sss_registrant_last_name).toBe('ALVAREZ');
  });
  it('refuses OCR from another page, image or template version',()=>{
    for(const wrong of [{...run,pageImageId:'other'},{...run,page:3},{...run,templateVersion:2}])
      expect(()=>fixedWithPage(newFixedDraft('id','now'),page,wrong,true)).toThrow(/identity/);
    expect(()=>fixedWithPage(newFixedDraft('id','now'),{...page,page:2},undefined,false)).toThrow(/reference-only/);
  });
});
describe('SSS atomic private persistence',()=>{
  function port():FixedPort{return {exists:vi.fn(async()=>true),copy:vi.fn(async()=> 'file:///private/new.jpg'),remove:vi.fn(async()=>{}),write:vi.fn(async()=>{})};}
  it('does not claim a ready save when an accepted image is missing',async()=>{
    const p=port();p.exists=vi.fn(async()=>false);
    await expect(saveFixed(p,{...complete(),state:'ready'},'later')).rejects.toThrow(/missing/);expect(p.write).not.toHaveBeenCalled();
  });
  it('rolls back a new image on metadata failure and retains the previous source and values',async()=>{
    const p=port();p.write=vi.fn(async()=>{throw new Error('database full');});const draft=complete();
    await expect(acceptFixedPage(p,draft,{...page,imageId:'new-image'},undefined,false,'later')).rejects.toThrow('database full');
    expect(p.remove).toHaveBeenCalledExactlyOnceWith('file:///private/new.jpg');expect(draft.pages[1]?.uri).toBe(page.uri);
  });
  it('commits image identity and raw readings before removing the replaced image',async()=>{
    const p=port();const events:string[]=[];p.write=vi.fn(async()=>{events.push('write');});p.remove=vi.fn(async()=>{events.push('remove');});
    const draft=complete();const accepted=await acceptFixedPage(p,draft,page,run,false,'later');
    expect(events).toEqual(['write','remove']);expect(accepted.history[0].pageImageId).toBe(accepted.pages[1]?.imageId);
    expect(accepted.values.sss_registrant_first_name).toBe('MIRA');
  });
});
