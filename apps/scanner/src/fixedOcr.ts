import * as Crypto from 'expo-crypto';
import { fixedTemplate, normalizeFixed, fixedFieldError, containsPrintedLabel, isAligned, pixelRegion,
  type FixedDraft, type FixedPage, type FixedRun, type FixedReading, type FixedField } from '@tala/core';
import TalaOcr, { type RoiResult } from '../modules/tala-ocr';
import { discardCache } from './repository';

export type FixedExtraction={run:FixedRun;diagnostics:Record<string,RoiResult>};
export async function recognizeFixedPage(draft:FixedDraft,page:FixedPage,progress:(value:string)=>void,
  retain?:(uri:string)=>void):Promise<FixedExtraction> {
  const template=fixedTemplate(draft.templateId,draft.templateVersion);
  const slot=template.pages.find(p=>p.number===page.page && p.capture);
  if(!slot || !isAligned(page))throw new Error('Align the correct SSS page before reading fields.');
  if(Math.abs(page.width/page.height-slot.width/slot.height)>.045)throw new Error('This crop does not match the upright SSS page proportions. Check all four paper corners.');
  const fields:Record<string,FixedReading>={};const diagnostics:Record<string,RoiResult>={};
  const mapped=template.fields.filter(f=>f.page===page.page && f.mode==='ocr' && f.region);
  for(const [index,field] of mapped.entries()) {
    progress(`${index+1}/${mapped.length}: ${field.label}`);
    const crop=pixelRegion(field.region!,page.width,page.height);
    const region={x:crop.originX/page.width,y:crop.originY/page.height,width:crop.width/page.width,height:crop.height/page.height};
    try {
      const result=await TalaOcr.recognizeField(page.uri,JSON.stringify({templateId:template.id,fieldId:field.id,part:0,
        x:crop.originX,y:crop.originY,width:crop.width,height:crop.height,cells:field.cells??1,kind:field.type,grid:!!field.grid,
        diagnostics:!!TalaOcr.diagnosticsEnabled && !!retain}));
      for(const uri of Object.values(result.diagnostics))if(uri){if(retain)retain(uri);else await discardCache(uri);}
      if(result.fieldId!==field.id || result.part!==0)throw new Error('Field identity mismatch.');
      fields[field.id]=fixedReading(field,result,page.imageId,region);
      if(TalaOcr.diagnosticsEnabled && retain)diagnostics[field.id]=result;
    } catch {
      fields[field.id]={fieldId:field.id,pageImageId:page.imageId,text:'',originalText:'',processedText:'',originalNormalized:'',processedNormalized:'',
        normalized:'',confidence:null,region,warning:'Reading failed. Enter this field from the source image.',error:'Field could not be read.'};
    }
  }
  return {diagnostics,run:{id:Crypto.randomUUID(),pageImageId:page.imageId,page:page.page,at:new Date().toISOString(),templateId:template.id,
    templateVersion:template.version,engine:'mlkit-bundled-latin-16.0.1',preprocessing:'native-roi-v3',fields}};
}
export function fixedReading(field:FixedField,result:RoiResult,imageId:string,region:FixedReading['region']):FixedReading {
  const candidates=[result.original,result.processed,...(result.segmented?[result.segmented]:[])].map(reading=>({
    reading,value:normalizeFixed(field,reading.readingText??reading.text),label:containsPrintedLabel(reading.text),
  }));
  const valid=candidates.filter(c=>!c.label&&!fixedFieldError(field,c.value));
  const validValues=[...new Set(valid.map(c=>c.value))];
  const allValues=[...new Set(candidates.map(c=>c.value))];
  const conflict=validValues.length>1 || validValues.length===0&&allValues.length>1;
  const chosen=valid.find(c=>c===candidates[1])??valid.at(-1)??candidates[1];
  const normalized=conflict||chosen.label?'':chosen.value;
  return {fieldId:field.id,pageImageId:imageId,region,text:chosen.reading.text,originalText:result.original.text,processedText:result.processed.text,
    originalNormalized:candidates[0].value,processedNormalized:candidates[1].value,segmentedText:result.segmented?.text,segmentedNormalized:candidates[2]?.value,
    normalized,confidence:chosen.reading.confidence,
    warning:chosen.label?'Printed label detected. Check alignment.':conflict?'Original, processed or segmented readings disagree. Enter the value manually.'
      :allValues.length>1?'Preprocessing / character grouping changed the reading. This proposal is uncertain; compare the source image.'
      :chosen.reading.confidence!==null&&chosen.reading.confidence<.8?'Low recognition confidence. Compare every character with the source image.':undefined,
    error:fixedFieldError(field,normalized)};
}
