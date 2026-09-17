import {z} from 'zod';
import {attachmentSchema,evidenceInterpretationSchema,evidenceSchema,type Attachment,type Evidence} from '../domain/core.ts';
import {mutationContextSchema,type MutationContext} from './facts-service.ts';

const uniqueIds=(ids:string[])=>new Set(ids).size===ids.length;
const factIdsSchema=z.array(z.uuid()).max(100).refine(uniqueIds,'factIds duplicados não são permitidos.');

export const documentInputSchema=z.object({
 id:z.uuid().optional(),
 name:z.string().trim().min(1).max(255),
 mime:z.string().trim().min(1).max(150),
 source:z.enum(['document','import']),
 factIds:factIdsSchema,
 extractedText:z.string().max(1_000_000).optional(),
 interpretation:evidenceInterpretationSchema.optional()
}).strict();
export type DocumentInput=z.infer<typeof documentInputSchema>;

export const evidenceUpdateInputSchema=z.object({
 factIds:factIdsSchema,
 extractedText:z.string().max(1_000_000).optional(),
 interpretation:evidenceInterpretationSchema.optional()
}).strict();
export type EvidenceUpdateInput=z.infer<typeof evidenceUpdateInputSchema>;

export interface DocumentRecord{attachment:Attachment;evidence:Evidence}
export interface DocumentFilter{factId?:string;attachmentId?:string}
export interface DeleteDocumentResult{evidenceId:string;attachment:Attachment;deleted:true}
export type EvidenceWriteRecord=Omit<Evidence,'createdAt'>;

export interface DocumentsRepository{
 putObject(attachment:Attachment,bytes:Uint8Array):Promise<void>;
 downloadObject(attachment:Attachment):Promise<Uint8Array>;
 removeObject(attachment:Attachment):Promise<void>;
 ingestDocument(context:MutationContext,input:{attachment:Attachment;evidence:EvidenceWriteRecord}):Promise<DocumentRecord>;
 updateEvidence(context:MutationContext,id:string,input:EvidenceUpdateInput):Promise<Evidence>;
 deleteDocument(context:MutationContext,evidenceId:string):Promise<DeleteDocumentResult>;
 getAttachment(id:string):Promise<Attachment|null>;
 getEvidence(id:string):Promise<Evidence|null>;
 listDocuments(filter?:DocumentFilter):Promise<DocumentRecord[]>;
}

async function sha256(bytes:Uint8Array):Promise<string>{
 const digest=await crypto.subtle.digest('SHA-256',Uint8Array.from(bytes));
 return Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
}

async function assertIntegrity(attachment:Attachment,bytes:Uint8Array):Promise<void>{
 if(bytes.byteLength!==attachment.size)throw new Error('Falha de integridade do documento: tamanho divergente.');
 if(await sha256(bytes)!==attachment.sha256)throw new Error('Falha de integridade do documento: SHA-256 divergente.');
}

function parseRecord(record:DocumentRecord):DocumentRecord{
 const attachment=attachmentSchema.parse(record.attachment);
 const evidence=evidenceSchema.parse(record.evidence);
 if(evidence.attachmentId!==attachment.id)throw new Error('Evidence aponta para outro Attachment.');
 return {attachment,evidence};
}

export class FactsDocumentsService{
 constructor(private readonly repository:DocumentsRepository){}

 async ingestDocument(context:MutationContext,input:DocumentInput,bytes:Uint8Array):Promise<DocumentRecord>{
  const ctx=mutationContextSchema.parse(context),data=documentInputSchema.parse(input);
  if(bytes.byteLength<1||bytes.byteLength>20*1024*1024)throw new Error('Documento deve ter entre 1 byte e 20 MB.');
  const id=data.id??ctx.mutationId;
  const attachment=attachmentSchema.parse({id,name:data.name,mime:data.mime,size:bytes.byteLength,sha256:await sha256(bytes)});
  const evidence=evidenceSchema.omit({createdAt:true}).parse({
   id,attachmentId:id,factIds:data.factIds,source:data.source,
   ...(data.extractedText===undefined?{}:{extractedText:data.extractedText}),
   ...(data.interpretation===undefined?{}:{interpretation:data.interpretation})
  }) as EvidenceWriteRecord;
  await this.repository.putObject(attachment,bytes);
  return parseRecord(await this.repository.ingestDocument(ctx,{attachment,evidence}));
 }

 async downloadAttachment(id:string):Promise<{attachment:Attachment;bytes:Uint8Array}>{
  const attachment=await this.repository.getAttachment(z.uuid().parse(id));
  if(!attachment)throw new Error('Documento não encontrado.');
  const parsed=attachmentSchema.parse(attachment),bytes=await this.repository.downloadObject(parsed);
  await assertIntegrity(parsed,bytes);
  return {attachment:parsed,bytes};
 }

 async getEvidence(id:string):Promise<Evidence|null>{
  const evidence=await this.repository.getEvidence(z.uuid().parse(id));
  return evidence?evidenceSchema.parse(evidence):null;
 }

 async updateEvidence(context:MutationContext,id:string,input:EvidenceUpdateInput):Promise<Evidence>{
  const result=await this.repository.updateEvidence(mutationContextSchema.parse(context),z.uuid().parse(id),evidenceUpdateInputSchema.parse(input));
  return evidenceSchema.parse(result);
 }

 async deleteDocument(context:MutationContext,evidenceId:string):Promise<DeleteDocumentResult>{
  const result=await this.repository.deleteDocument(mutationContextSchema.parse(context),z.uuid().parse(evidenceId));
  const parsed:DeleteDocumentResult={evidenceId:z.uuid().parse(result.evidenceId),attachment:attachmentSchema.parse(result.attachment),deleted:true};
  await this.repository.removeObject(parsed.attachment);
  return parsed;
 }

 async listDocuments(filter:DocumentFilter={}):Promise<DocumentRecord[]>{
  const parsed={...(filter.factId?{factId:z.uuid().parse(filter.factId)}:{}),...(filter.attachmentId?{attachmentId:z.uuid().parse(filter.attachmentId)}:{})};
  return (await this.repository.listDocuments(parsed)).map(parseRecord);
 }
}
