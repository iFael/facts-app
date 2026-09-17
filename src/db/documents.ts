import {z} from 'zod';
import type {SupabaseClient} from '@supabase/supabase-js';
import {attachmentSchema,evidenceInterpretationSchema,evidenceSchema,type Attachment,type Evidence} from '../domain/core.ts';
import {FactsDocumentsService,type DeleteDocumentResult,type DocumentFilter,type DocumentRecord,type DocumentsRepository,type EvidenceUpdateInput,type EvidenceWriteRecord} from '../service/documents-service.ts';
import type {MutationContext} from '../service/facts-service.ts';

const attachmentRowSchema=z.object({
 id:z.uuid(),name:z.string(),mime:z.string(),size:z.number().int(),sha256:z.string(),created_at:z.string()
}).passthrough();
const evidenceRowSchema=z.object({
 id:z.uuid(),attachment_id:z.uuid(),source:z.enum(['document','import']),extracted_text:z.string().nullable(),interpretation:z.unknown().nullable(),created_at:z.string(),fact_ids:z.array(z.uuid()).optional()
}).passthrough();
const deleteRowSchema=z.object({evidence_id:z.uuid(),attachment:z.unknown(),deleted:z.literal(true)}).passthrough();

function mapAttachment(input:unknown):Attachment{
 const row=attachmentRowSchema.parse(input);
 return attachmentSchema.parse({id:row.id,name:row.name,mime:row.mime,size:row.size,sha256:row.sha256});
}
function mapEvidence(input:unknown,factIds?:string[]):Evidence{
 const row=evidenceRowSchema.parse(input),ids=factIds??row.fact_ids??[];
 return evidenceSchema.parse({
  id:row.id,attachmentId:row.attachment_id,factIds:ids,source:row.source,createdAt:row.created_at,
  ...(row.extracted_text===null?{}:{extractedText:row.extracted_text}),
  ...(row.interpretation===null?{}:{interpretation:evidenceInterpretationSchema.parse(row.interpretation)})
 });
}
function sameBytes(a:Uint8Array,b:Uint8Array):boolean{
 if(a.byteLength!==b.byteLength)return false;
 for(let i=0;i<a.byteLength;i++)if(a[i]!==b[i])return false;
 return true;
}

export class SupabaseDocumentsRepository implements DocumentsRepository{
 constructor(private readonly client:SupabaseClient){}

 private async rpc(name:string,args:Record<string,unknown>):Promise<unknown>{
  const {data,error}=await this.client.rpc(name,args);
  if(error)throw error;
  return data;
 }
 private async ownerId():Promise<string>{
  const {data,error}=await this.client.auth.getUser();
  if(error)throw error;
  if(!data.user)throw new Error('Sessão autenticada necessária para acessar documentos.');
  return data.user.id;
 }
 private async path(attachment:Attachment):Promise<string>{return `${await this.ownerId()}/${attachment.id}/${attachment.sha256}`;}
 private bucket(){return this.client.storage.from('facts-attachments');}

 async putObject(attachment:Attachment,bytes:Uint8Array):Promise<void>{
  const path=await this.path(attachment),bucket=this.bucket();
  const {error}=await bucket.upload(path,bytes,{upsert:false,contentType:attachment.mime,cacheControl:'31536000'});
  if(!error)return;
  const existing=await bucket.download(path);
  if(existing.error||!existing.data)throw error;
  const existingBytes=new Uint8Array(await existing.data.arrayBuffer());
  if(!sameBytes(existingBytes,bytes))throw error;
 }
 async downloadObject(attachment:Attachment):Promise<Uint8Array>{
  const {data,error}=await this.bucket().download(await this.path(attachment));
  if(error)throw error;
  return new Uint8Array(await data.arrayBuffer());
 }
 async removeObject(attachment:Attachment):Promise<void>{
  const {error}=await this.bucket().remove([await this.path(attachment)]);
  if(error)throw error;
 }

 async ingestDocument(context:MutationContext,input:{attachment:Attachment;evidence:EvidenceWriteRecord}):Promise<DocumentRecord>{
  const data=await this.rpc('facts_ingest_document',{
   p_mutation_id:context.mutationId,p_attachment_id:input.attachment.id,p_evidence_id:input.evidence.id,
   p_name:input.attachment.name,p_mime:input.attachment.mime,p_size:input.attachment.size,p_sha256:input.attachment.sha256,
   p_evidence_source:input.evidence.source,p_extracted_text:input.evidence.extractedText??null,p_interpretation:input.evidence.interpretation??null,
   p_fact_ids:input.evidence.factIds,p_source:context.source,p_created_by:context.createdBy
  });
  const parsed=z.object({attachment:z.unknown(),evidence:z.unknown()}).parse(data);
  return {attachment:mapAttachment(parsed.attachment),evidence:mapEvidence(parsed.evidence)};
 }
 async updateEvidence(context:MutationContext,id:string,input:EvidenceUpdateInput):Promise<Evidence>{
  return mapEvidence(await this.rpc('facts_update_evidence',{
   p_mutation_id:context.mutationId,p_id:id,p_extracted_text:input.extractedText??null,p_interpretation:input.interpretation??null,
   p_fact_ids:input.factIds,p_source:context.source,p_created_by:context.createdBy
  }));
 }
 async deleteDocument(context:MutationContext,evidenceId:string):Promise<DeleteDocumentResult>{
  const row=deleteRowSchema.parse(await this.rpc('facts_delete_document',{p_mutation_id:context.mutationId,p_evidence_id:evidenceId,p_source:context.source,p_created_by:context.createdBy}));
  return {evidenceId:row.evidence_id,attachment:mapAttachment(row.attachment),deleted:true};
 }

 async getAttachment(id:string):Promise<Attachment|null>{
  const {data,error}=await this.client.from('facts_attachments').select('id,name,mime,size,sha256,created_at').eq('id',id).maybeSingle();
  if(error)throw error;
  return data?mapAttachment(data):null;
 }
 private async linksForEvidenceIds(ids:string[]):Promise<Map<string,string[]>>{
  const result=new Map<string,string[]>();
  for(const id of ids)result.set(id,[]);
  if(!ids.length)return result;
  const {data,error}=await this.client.from('facts_evidence_links').select('evidence_id,fact_id').in('evidence_id',ids);
  if(error)throw error;
  for(const row of data??[]){
   const parsed=z.object({evidence_id:z.uuid(),fact_id:z.uuid()}).parse(row),current=result.get(parsed.evidence_id)??[];
   current.push(parsed.fact_id);result.set(parsed.evidence_id,current);
  }
  return result;
 }
 async getEvidence(id:string):Promise<Evidence|null>{
  const {data,error}=await this.client.from('facts_evidence').select('id,attachment_id,source,extracted_text,interpretation,created_at').eq('id',id).maybeSingle();
  if(error)throw error;
  if(!data)return null;
  const links=await this.linksForEvidenceIds([id]);
  return mapEvidence(data,links.get(id));
 }
 async listDocuments(filter:DocumentFilter={}):Promise<DocumentRecord[]>{
  let evidenceIds:string[]|undefined;
  if(filter.factId){
   const {data,error}=await this.client.from('facts_evidence_links').select('evidence_id').eq('fact_id',filter.factId);
   if(error)throw error;
   evidenceIds=(data??[]).map(row=>z.object({evidence_id:z.uuid()}).parse(row).evidence_id);
   if(!evidenceIds.length)return [];
  }
  let query=this.client.from('facts_evidence').select('id,attachment_id,source,extracted_text,interpretation,created_at');
  if(filter.attachmentId)query=query.eq('attachment_id',filter.attachmentId);
  if(evidenceIds)query=query.in('id',evidenceIds);
  const {data:evidenceRows,error:evidenceError}=await query.order('created_at',{ascending:false});
  if(evidenceError)throw evidenceError;
  if(!evidenceRows?.length)return [];
  const parsedRows=evidenceRows.map(row=>evidenceRowSchema.parse(row));
  const attachmentIds=[...new Set(parsedRows.map(row=>row.attachment_id))];
  const ids=parsedRows.map(row=>row.id);
  const [{data:attachmentRows,error:attachmentError},links]=await Promise.all([
   this.client.from('facts_attachments').select('id,name,mime,size,sha256,created_at').in('id',attachmentIds),
   this.linksForEvidenceIds(ids)
  ]);
  if(attachmentError)throw attachmentError;
  const attachments=new Map((attachmentRows??[]).map(row=>{const attachment=mapAttachment(row);return [attachment.id,attachment] as const;}));
  return parsedRows.map(row=>{
   const attachment=attachments.get(row.attachment_id);
   if(!attachment)throw new Error('Attachment referenciado pela Evidence não foi encontrado.');
   return {attachment,evidence:mapEvidence(row,links.get(row.id))};
  });
 }
}

export function createSupabaseDocumentsService(client:SupabaseClient){return new FactsDocumentsService(new SupabaseDocumentsRepository(client));}
