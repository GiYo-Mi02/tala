import { z } from 'zod';

const id=z.uuidv4();
const text=z.string();
const number=z.number().int().nonnegative();
const date=z.iso.datetime();
export const status=z.enum(['DRAFT','UPLOADING','PENDING_VERIFICATION','IN_REVIEW','NEEDS_CORRECTION','VERIFIED','REJECTED','FINALIZED','EXPIRED']);
export type Status=z.infer<typeof status>;
export const account=z.object({id,email:z.email(),role:z.enum(['ENCODER','VERIFIER','ADMIN'])});
export type Account=z.infer<typeof account>;
export const token=z.object({accessToken:z.string().regex(/^[A-Za-z0-9_-]{43}$/), tokenType:z.literal('Bearer')});
const baseSubmission=z.object({id,clientSubmissionId:id,status,revision:number,templateId:text,templateVersion:number,
  capturedAt:date,receivedAt:date,updatedAt:date,completedAt:date.nullable(),reviewerId:id.nullable()});
const row=baseSubmission.extend({pageCount:number,submittedBy:account.pick({id:true,email:true}).optional()});
export type SubmissionRow=z.infer<typeof row>;
export const listing=z.object({items:z.array(row),nextOffset:number.nullable()});
export const overview=z.object({total:number,counts:z.partialRecord(status,number),recent:z.array(row)});
const template=z.object({id:text,version:number,name:text});
export const catalog=z.object({items:z.array(template)});
export type TemplateRef=z.infer<typeof template>;
const page=z.object({pageNumber:number,imageId:id,mimeType:z.enum(['image/jpeg','image/png']),width:number.positive(),
  height:number.positive(),byteSize:number.positive(),uploadedAt:date});
export type ScanPage=z.infer<typeof page>;
const field=z.object({key:text,pageNumber:number,mobileValue:text,confirmed:z.boolean(),reviewValue:text.nullable(),finalValue:text.nullable(),
  ocr:z.object({original:text,imageId:id,confidence:z.number().min(0).max(1).nullish(),warning:text.optional()}).nullable()});
const decision=z.object({outcome:text,notes:text.nullable(),at:date});
export const detail=baseSubmission.extend({
  pages:z.array(page),fields:z.array(field),
  receipt:z.object({submissionId:id,acknowledgedAt:date}).nullable(),decision:decision.nullable(),
});
export type SubmissionDetail=z.infer<typeof detail>;
export type FieldValue=z.infer<typeof field>;
export const templateDetail=template.extend({
  pages:z.array(z.object({pageNumber:number,order:number,label:text,capture:z.boolean()})),
  fields:z.array(z.object({id:text,label:text,type:text,section:text.optional(),page:number,
    displayOrder:number,required:z.boolean().optional(),mode:text.optional(),
    when:z.object({field:text,values:z.array(text)}).optional()})),
});
export type TemplateDefinition=z.infer<typeof templateDetail>;
export type FieldDefinition=TemplateDefinition['fields'][number];
export const publicError=z.object({error:z.object({code:text,message:text,requestId:text.optional()})});
