import {z} from 'zod';
import type {SupabaseClient} from '@supabase/supabase-js';
import {auditEntrySchema,dependentSchema,factRelationshipSchema,factSchema,type Fact} from '../domain/core.ts';
import {FactsService,type AuditFilter,type FactCreateRecord,type FactFilter,type FactUpdateInput,type FactsRepository,type MutationContext} from '../service/facts-service.ts';

const dependentRowSchema=z.object({id:z.uuid(),name:z.string(),birth_date:z.string().nullable(),created_at:z.string(),updated_at:z.string()}).passthrough();
const factRowSchema=z.object({
 id:z.uuid(),dependent_id:z.uuid(),kind:z.enum(['expense','payment','transfer','request','event']),title:z.string(),category:z.enum(['alimentacao','saude','vestuario','transporte','higiene','educacao','lazer','outros']),notes:z.string(),occurred_at:z.string(),
 amount_cents:z.number().int().nullable(),transfer_purpose:z.enum(['pensao','adicional','reembolso']).nullable(),request_total_cents:z.number().int().nullable(),
 source:z.enum(['chat','ui','document','import']),source_detail:z.string().nullable(),created_by:z.enum(['user','assistant']),provenance_kind:z.enum(['user_assertion','assistant_interpretation','evidence_derived','imported']),created_at:z.string(),updated_at:z.string()
}).passthrough();
const relationshipRowSchema=z.object({id:z.uuid(),kind:z.literal('fulfills_request'),fact_id:z.uuid(),request_id:z.uuid(),created_at:z.string()}).passthrough();
const auditRowSchema=z.object({
 id:z.uuid(),mutation_id:z.uuid(),entity_type:z.enum(['dependent','fact','evidence','attachment','relationship']),entity_id:z.uuid(),
 action:z.enum(['create','update','delete','link','unlink']),source:z.enum(['chat','ui','document','import']),created_by:z.enum(['user','assistant']),
 changed_at:z.string(),before_state:z.unknown().nullable(),after_state:z.unknown().nullable()
}).passthrough();
const deleteResultSchema=z.object({id:z.uuid(),deleted:z.literal(true)}).strict();
const unlinkResultSchema=z.object({id:z.uuid(),unlinked:z.literal(true)}).strict();

function normalizeTimestamp(value:string):string{
 const parsed=new Date(value);
 return Number.isNaN(parsed.getTime())?value:parsed.toISOString();
}

function mapDependent(input:unknown){
 const row=dependentRowSchema.parse(input);
 return dependentSchema.parse({id:row.id,name:row.name,...(row.birth_date?{birthDate:row.birth_date}:{}),createdAt:normalizeTimestamp(row.created_at),updatedAt:normalizeTimestamp(row.updated_at)});
}
function mapFact(input:unknown):Fact{
 const row=factRowSchema.parse(input);
 const common={id:row.id,dependentId:row.dependent_id,title:row.title,category:row.category,notes:row.notes,occurredAt:row.occurred_at,source:row.source,...(row.source_detail?{sourceDetail:row.source_detail}:{}),createdBy:row.created_by,provenanceKind:row.provenance_kind,createdAt:normalizeTimestamp(row.created_at),updatedAt:normalizeTimestamp(row.updated_at)};
 switch(row.kind){
  case 'event':return factSchema.parse({...common,kind:'event'});
  case 'transfer':return factSchema.parse({...common,kind:'transfer',amountCents:row.amount_cents,transferPurpose:row.transfer_purpose});
  case 'request':return factSchema.parse({...common,kind:'request',amountCents:row.amount_cents,...(row.request_total_cents===null?{}:{requestTotalCents:row.request_total_cents})});
  case 'payment':return factSchema.parse({...common,kind:'payment',amountCents:row.amount_cents});
  case 'expense':return factSchema.parse({...common,kind:'expense',amountCents:row.amount_cents});
 }
}
function mapRelationship(input:unknown){
 const row=relationshipRowSchema.parse(input);
 return factRelationshipSchema.parse({id:row.id,kind:row.kind,factId:row.fact_id,requestId:row.request_id,createdAt:normalizeTimestamp(row.created_at)});
}
function mapAudit(input:unknown){
 const row=auditRowSchema.parse(input);
 return auditEntrySchema.parse({
  id:row.id,mutationId:row.mutation_id,entityType:row.entity_type,entityId:row.entity_id,action:row.action,
  source:row.source,createdBy:row.created_by,changedAt:normalizeTimestamp(row.changed_at),before:row.before_state,after:row.after_state
 });
}

export class SupabaseFactsRepository implements FactsRepository{
 constructor(private readonly client:SupabaseClient){}
 private async rpc(name:string,args:Record<string,unknown>):Promise<unknown>{
  const {data,error}=await this.client.rpc(name,args);
  if(error)throw error;
  return data;
 }
 async upsertDependent(context:MutationContext,input:{id:string;name:string;birthDate?:string}){
  return mapDependent(await this.rpc('facts_upsert_dependent',{p_mutation_id:context.mutationId,p_id:input.id,p_name:input.name,p_birth_date:input.birthDate??null,p_source:context.source,p_created_by:context.createdBy}));
 }
 async deleteDependent(context:MutationContext,id:string){return deleteResultSchema.parse(await this.rpc('facts_delete_dependent',{p_mutation_id:context.mutationId,p_id:id,p_source:context.source,p_created_by:context.createdBy}));}
 async getDependent(id:string){
  const {data,error}=await this.client.from('facts_dependents').select('*').eq('id',id).maybeSingle();
  if(error)throw error;return data?mapDependent(data):null;
 }
 async listDependents(){
  const {data,error}=await this.client.from('facts_dependents').select('*').order('name',{ascending:true}).order('id',{ascending:true});
  if(error)throw error;return (data??[]).map(mapDependent);
 }
 async listAudit(filter:AuditFilter={}){
  let query=this.client.from('facts_audit_entries').select('*');
  if(filter.entityType)query=query.eq('entity_type',filter.entityType);
  if(filter.entityId)query=query.eq('entity_id',filter.entityId);
  if(filter.mutationId)query=query.eq('mutation_id',filter.mutationId);
  if(filter.action)query=query.eq('action',filter.action);
  const {data,error}=await query.order('changed_at',{ascending:false}).limit(filter.limit??100);
  if(error)throw error;return (data??[]).map(mapAudit);
 }
 async createFact(context:MutationContext,fact:FactCreateRecord){
  return mapFact(await this.rpc('facts_create_fact',{
   p_mutation_id:context.mutationId,p_id:fact.id,p_dependent_id:fact.dependentId,p_kind:fact.kind,p_title:fact.title,p_category:fact.category,p_notes:fact.notes,p_occurred_at:fact.occurredAt,
   p_amount_cents:fact.kind==='event'?null:fact.amountCents,p_transfer_purpose:fact.kind==='transfer'?fact.transferPurpose:null,p_request_total_cents:fact.kind==='request'?fact.requestTotalCents??null:null,
   p_source:fact.source,p_source_detail:fact.sourceDetail??null,p_created_by:fact.createdBy,p_provenance_kind:fact.provenanceKind
  }));
 }
 async updateFact(context:MutationContext,id:string,input:FactUpdateInput){
  return mapFact(await this.rpc('facts_update_fact',{
   p_mutation_id:context.mutationId,p_id:id,p_kind:input.kind,p_title:input.title,p_category:input.category,p_notes:input.notes,p_occurred_at:input.occurredAt,
   p_amount_cents:input.kind==='event'?null:input.amountCents,p_transfer_purpose:input.kind==='transfer'?input.transferPurpose:null,p_request_total_cents:input.kind==='request'?input.requestTotalCents??null:null,
   p_source_detail:input.sourceDetail??null,p_source:context.source,p_created_by:context.createdBy
  }));
 }
 async deleteFact(context:MutationContext,id:string){return deleteResultSchema.parse(await this.rpc('facts_delete_fact',{p_mutation_id:context.mutationId,p_id:id,p_source:context.source,p_created_by:context.createdBy}));}
 async linkRequest(context:MutationContext,input:{id:string;factId:string;requestId:string}){
  return mapRelationship(await this.rpc('facts_link_request',{p_mutation_id:context.mutationId,p_id:input.id,p_fact_id:input.factId,p_request_id:input.requestId,p_source:context.source,p_created_by:context.createdBy}));
 }
 async unlinkRequest(context:MutationContext,id:string){return unlinkResultSchema.parse(await this.rpc('facts_unlink_request',{p_mutation_id:context.mutationId,p_id:id,p_source:context.source,p_created_by:context.createdBy}));}
 async getFact(id:string){
  const {data,error}=await this.client.from('facts').select('*').eq('id',id).maybeSingle();
  if(error)throw error;return data?mapFact(data):null;
 }
 async listFacts(filter:FactFilter={}){
  let query=this.client.from('facts').select('*');
  if(filter.from)query=query.gte('occurred_at',filter.from);
  if(filter.to)query=query.lte('occurred_at',filter.to);
  if(filter.kinds?.length)query=query.in('kind',filter.kinds);
  if(filter.category)query=query.eq('category',filter.category);
  if(filter.dependentId)query=query.eq('dependent_id',filter.dependentId);
  const {data,error}=await query.order('occurred_at',{ascending:false}).order('created_at',{ascending:false});
  if(error)throw error;return (data??[]).map(mapFact);
 }
 async listRelationships(){
  const {data,error}=await this.client.from('facts_relationships').select('*').order('created_at',{ascending:true});
  if(error)throw error;return (data??[]).map(mapRelationship);
 }
}

export function createSupabaseFactsService(client:SupabaseClient){return new FactsService(new SupabaseFactsRepository(client));}
