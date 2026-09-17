import {describe,expect,it} from 'vitest';
import type {AuditEntry,Dependent,Fact,FactRelationship} from '../domain/core';
import {FactsService,type AuditFilter,type FactCreateRecord,type FactFilter,type FactUpdateInput,type FactsRepository,type MutationContext} from './facts-service';

const stamp='2026-09-14T21:30:00.000Z';
const dependentId='30000000-0000-4000-8000-000000000001';
const mutation=(id:string,source:MutationContext['source']='chat',createdBy:MutationContext['createdBy']='assistant'):MutationContext=>({mutationId:id,source,createdBy});

class MemoryRepository implements FactsRepository{
 dependents:Dependent[]=[];
 facts:Fact[]=[];
 relationships:FactRelationship[]=[];
 audit:AuditEntry[]=[];
 lastCreate?:{context:MutationContext;fact:FactCreateRecord};
 async upsertDependent(_context:MutationContext,input:{id:string;name:string;birthDate?:string}){
  const next:Dependent={id:input.id,name:input.name,...(input.birthDate?{birthDate:input.birthDate}:{}),createdAt:stamp,updatedAt:stamp};
  this.dependents=[...this.dependents.filter(item=>item.id!==input.id),next];return next;
 }
 async deleteDependent(_context:MutationContext,id:string){this.dependents=this.dependents.filter(item=>item.id!==id);return {id,deleted:true as const};}
 async getDependent(id:string){return this.dependents.find(item=>item.id===id)??null;}
 async listDependents(){return [...this.dependents];}
 async listAudit(_filter?:AuditFilter){return [...this.audit];}
 async createFact(context:MutationContext,fact:FactCreateRecord){
  this.lastCreate={context,fact};const next={...fact,createdAt:stamp,updatedAt:stamp} as Fact;this.facts.push(next);return next;
 }
 async updateFact(_context:MutationContext,id:string,input:FactUpdateInput){
  const index=this.facts.findIndex(item=>item.id===id);if(index<0)throw new Error('missing');
  const current=this.facts[index];const next={...current,...input,updatedAt:stamp} as Fact;this.facts[index]=next;return next;
 }
 async deleteFact(_context:MutationContext,id:string){this.facts=this.facts.filter(item=>item.id!==id);return {id,deleted:true as const};}
 async linkRequest(_context:MutationContext,input:{id:string;factId:string;requestId:string}){const next={...input,kind:'fulfills_request' as const,createdAt:stamp};this.relationships.push(next);return next;}
 async unlinkRequest(_context:MutationContext,id:string){this.relationships=this.relationships.filter(item=>item.id!==id);return {id,unlinked:true as const};}
 async getFact(id:string){return this.facts.find(item=>item.id===id)??null;}
 async listFacts(_filter?:FactFilter){return [...this.facts];}
 async listRelationships(){return [...this.relationships];}
}

const common=(id:string)=>({id,dependentId,title:'Registro',category:'outros' as const,notes:'',occurredAt:'2026-09-14',source:'chat' as const,createdBy:'assistant' as const,provenanceKind:'user_assertion' as const,createdAt:stamp,updatedAt:stamp});
const expense=(id:string,amountCents:number):Fact=>({...common(id),kind:'expense',amountCents});
const payment=(id:string,amountCents:number):Fact=>({...common(id),kind:'payment',amountCents});
const transfer=(id:string,amountCents:number):Fact=>({...common(id),kind:'transfer',amountCents,transferPurpose:'reembolso'});
const request=(id:string,amountCents:number):Fact=>({...common(id),kind:'request',amountCents});
const event=(id:string):Fact=>({...common(id),kind:'event'});

describe('FactsService',()=>{
 it('cria despesa usando mutationId como identidade estável e valida centavos',async()=>{
  const repo=new MemoryRepository(),service=new FactsService(repo);
  const ctx=mutation('30000000-0000-4000-8000-000000000010');
  const created=await service.createExpense(ctx,{dependentId,title:'Farmácia',category:'saude',notes:'',occurredAt:'2026-09-14',amountCents:2590,provenanceKind:'user_assertion'});
  expect(created.id).toBe(ctx.mutationId);
  expect(repo.lastCreate?.fact.kind).toBe('expense');
  expect(repo.lastCreate?.context).toEqual(ctx);
  await expect(service.createExpense(mutation('30000000-0000-4000-8000-000000000011'),{dependentId,title:'Inválida',category:'saude',notes:'',occurredAt:'2026-09-14',amountCents:25.9,provenanceKind:'user_assertion'})).rejects.toThrow();
 });

 it('cria event sem aceitar valor monetário',async()=>{
  const service=new FactsService(new MemoryRepository());
  const created=await service.createEvent(mutation('30000000-0000-4000-8000-000000000012'),{dependentId,title:'Consulta',category:'saude',notes:'',occurredAt:'2026-09-14',provenanceKind:'user_assertion'});
  expect(created.kind).toBe('event');
  await expect(service.createEvent(mutation('30000000-0000-4000-8000-000000000013'),{dependentId,title:'Inválido',category:'saude',notes:'',occurredAt:'2026-09-14',provenanceKind:'user_assertion',amountCents:1000} as never)).rejects.toThrow();
 });

 it('rejeita solicitação inconsistente antes do repositório e usa mutationId no vínculo',async()=>{
  const repo=new MemoryRepository(),service=new FactsService(repo);
  await expect(service.createRequest(mutation('30000000-0000-4000-8000-000000000014'),{dependentId,title:'Pedido inválido',category:'outros',notes:'',occurredAt:'2026-09-14',amountCents:5000,requestTotalCents:4000,provenanceKind:'user_assertion'})).rejects.toThrow();
  repo.facts=[expense('30000000-0000-4000-8000-000000000015',1000),request('30000000-0000-4000-8000-000000000016',1000)];
  const ctx=mutation('30000000-0000-4000-8000-000000000017','ui','user');
  const link=await service.linkDisbursementToRequest(ctx,{factId:repo.facts[0].id,requestId:repo.facts[1].id});
  expect(link.id).toBe(ctx.mutationId);
 });
 it('resume todos os desembolsos e deriva solicitações pendentes pelos relacionamentos',async()=>{
  const repo=new MemoryRepository(),service=new FactsService(repo);
  const req=request('30000000-0000-4000-8000-000000000020',5000);
  repo.facts=[expense('30000000-0000-4000-8000-000000000021',1000),payment('30000000-0000-4000-8000-000000000022',2000),transfer('30000000-0000-4000-8000-000000000023',3000),req,event('30000000-0000-4000-8000-000000000024')];
  repo.relationships=[{id:'30000000-0000-4000-8000-000000000025',kind:'fulfills_request',factId:'30000000-0000-4000-8000-000000000022',requestId:req.id,createdAt:stamp}];
  const summary=await service.getSummary({from:'2026-09-01',to:'2026-09-30'});
  expect(summary).toEqual({expenseCents:1000,paymentCents:2000,transferCents:3000,totalCents:6000,pendingRequests:1});
  const pending=await service.getPendingRequests();
  expect(pending).toHaveLength(1);
  expect(pending[0]).toMatchObject({request:req,paidCents:2000,pendingCents:3000});
 });
});
