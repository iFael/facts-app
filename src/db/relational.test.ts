import {describe,expect,it} from 'vitest';
import type {SupabaseClient} from '@supabase/supabase-js';
import {FactsService} from '../service/facts-service';
import {SupabaseFactsRepository} from './relational';

const mutationId='40000000-0000-4000-8000-000000000001';
const dependentId='40000000-0000-4000-8000-000000000002';

describe('SupabaseFactsRepository',()=>{
 it('traduz createExpense para a RPC e valida a resposta relacional',async()=>{
  let calledName='',calledArgs:Record<string,unknown>={};
  const client={rpc:async(name:string,args:Record<string,unknown>)=>{
   calledName=name;calledArgs=args;
   return {data:{id:mutationId,dependent_id:dependentId,kind:'expense',title:'Farmácia',category:'saude',notes:'',occurred_at:'2026-09-14',amount_cents:2590,transfer_purpose:null,request_total_cents:null,source:'chat',source_detail:'WhatsApp',created_by:'assistant',provenance_kind:'user_assertion',created_at:'2026-09-14T21:30:00.000Z',updated_at:'2026-09-14T21:30:00.000Z'},error:null};
  }} as unknown as SupabaseClient;
  const service=new FactsService(new SupabaseFactsRepository(client));
  const result=await service.createExpense({mutationId,source:'chat',createdBy:'assistant'},{dependentId,title:'Farmácia',category:'saude',notes:'',occurredAt:'2026-09-14',amountCents:2590,sourceDetail:'WhatsApp',provenanceKind:'user_assertion'});
  expect(calledName).toBe('facts_create_fact');
  expect(calledArgs).toMatchObject({p_mutation_id:mutationId,p_id:mutationId,p_dependent_id:dependentId,p_amount_cents:2590,p_source:'chat'});
  expect(result).toMatchObject({id:mutationId,dependentId,kind:'expense',amountCents:2590,sourceDetail:'WhatsApp'});
 });

 it('normaliza timestamps PostgreSQL com offset antes de validar o Domain Core',async()=>{
  const client={rpc:async()=>({data:{id:dependentId,name:'Homologação',birth_date:null,created_at:'2026-09-14T23:12:34.123456+00:00',updated_at:'2026-09-14T23:12:34.123456+00:00'},error:null})} as unknown as SupabaseClient;
  const service=new FactsService(new SupabaseFactsRepository(client));
  const result=await service.upsertDependent({mutationId,source:'chat',createdBy:'assistant'},{id:dependentId,name:'Homologação'});
  expect(result.createdAt).toBe('2026-09-14T23:12:34.123Z');
  expect(result.updatedAt).toBe('2026-09-14T23:12:34.123Z');
 });

 it('propaga erro do Supabase sem mascarar a causa',async()=>{
  const error={message:'FACTS_MUTATION_ID_REUSED',code:'22023'};
  const client={rpc:async()=>({data:null,error})} as unknown as SupabaseClient;
  const service=new FactsService(new SupabaseFactsRepository(client));
  await expect(service.createEvent({mutationId,source:'chat',createdBy:'assistant'},{dependentId,title:'Evento',category:'outros',notes:'',occurredAt:'2026-09-14',provenanceKind:'user_assertion'})).rejects.toBe(error);
 });
});
