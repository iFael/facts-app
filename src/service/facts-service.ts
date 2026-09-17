import {z} from 'zod';
import {
 actorSchema,categorySchema,civilDateSchema,dependentSchema,eventSchema,expenseSchema,
 factSourceSchema,paymentSchema,requestSchema,transferSchema,
 type AuditEntry,type Dependent,type Fact,type FactRelationship
} from '../domain/core.ts';

export const mutationContextSchema=z.object({mutationId:z.uuid(),source:factSourceSchema,createdBy:actorSchema}).strict();
export type MutationContext=z.infer<typeof mutationContextSchema>;

const dependentInputSchema=dependentSchema.omit({id:true,createdAt:true,updatedAt:true}).extend({id:z.uuid().optional()}).strict();
export type DependentInput=z.infer<typeof dependentInputSchema>;

const createOmit={id:true,kind:true,source:true,createdBy:true,createdAt:true,updatedAt:true} as const;
const expenseInputSchema=expenseSchema.omit(createOmit).extend({id:z.uuid().optional()}).strict();
const paymentInputSchema=paymentSchema.omit(createOmit).extend({id:z.uuid().optional()}).strict();
const transferInputSchema=transferSchema.omit(createOmit).extend({id:z.uuid().optional()}).strict();
const requestInputSchema=requestSchema.omit(createOmit).extend({id:z.uuid().optional()}).strict().superRefine((request,ctx)=>{
 if(request.requestTotalCents!==undefined&&request.requestTotalCents<request.amountCents)ctx.addIssue({code:'custom',path:['requestTotalCents'],message:'O total deve ser maior ou igual ao valor solicitado.'});
});
const eventInputSchema=eventSchema.omit(createOmit).extend({id:z.uuid().optional()}).strict();
export type ExpenseInput=z.infer<typeof expenseInputSchema>;
export type PaymentInput=z.infer<typeof paymentInputSchema>;
export type TransferInput=z.infer<typeof transferInputSchema>;
export type RequestInput=z.infer<typeof requestInputSchema>;
export type EventInput=z.infer<typeof eventInputSchema>;

const updateOmit={id:true,dependentId:true,source:true,createdBy:true,provenanceKind:true,createdAt:true,updatedAt:true} as const;
const factUpdateSchema=z.discriminatedUnion('kind',[
 expenseSchema.omit(updateOmit),paymentSchema.omit(updateOmit),transferSchema.omit(updateOmit),requestSchema.omit(updateOmit),eventSchema.omit(updateOmit)
]).superRefine((fact,ctx)=>{
 if(fact.kind==='request'&&fact.requestTotalCents!==undefined&&fact.requestTotalCents<fact.amountCents)ctx.addIssue({code:'custom',path:['requestTotalCents'],message:'O total deve ser maior ou igual ao valor solicitado.'});
});
export type FactUpdateInput=z.infer<typeof factUpdateSchema>;

type WithoutTimestamps<T>=T extends unknown?Omit<T,'createdAt'|'updatedAt'>:never;
export type FactCreateRecord=WithoutTimestamps<Fact>;

export const factFilterSchema=z.object({
 from:civilDateSchema.optional(),to:civilDateSchema.optional(),
 kinds:z.array(z.enum(['expense','payment','transfer','request','event'])).max(5).optional(),
 category:categorySchema.optional(),dependentId:z.uuid().optional(),search:z.string().trim().max(200).optional()
}).strict().superRefine((filter,ctx)=>{if(filter.from&&filter.to&&filter.from>filter.to)ctx.addIssue({code:'custom',path:['to'],message:'Período inválido.'});});
export type FactFilter=z.infer<typeof factFilterSchema>;

export const auditFilterSchema=z.object({
 entityType:z.enum(['dependent','fact','evidence','attachment','relationship']).optional(),
 entityId:z.uuid().optional(),mutationId:z.uuid().optional(),
 action:z.enum(['create','update','delete','link','unlink']).optional(),
 limit:z.number().int().min(1).max(200).optional()
}).strict();
export type AuditFilter=z.infer<typeof auditFilterSchema>;

export interface FactsRepository{
 upsertDependent(context:MutationContext,input:{id:string;name:string;birthDate?:string}):Promise<Dependent>;
 deleteDependent(context:MutationContext,id:string):Promise<{id:string;deleted:true}>;
 getDependent(id:string):Promise<Dependent|null>;
 listDependents():Promise<Dependent[]>;
 listAudit(filter?:AuditFilter):Promise<AuditEntry[]>;
 createFact(context:MutationContext,fact:FactCreateRecord):Promise<Fact>;
 updateFact(context:MutationContext,id:string,input:FactUpdateInput):Promise<Fact>;
 deleteFact(context:MutationContext,id:string):Promise<{id:string;deleted:true}>;
 linkRequest(context:MutationContext,input:{id:string;factId:string;requestId:string}):Promise<FactRelationship>;
 unlinkRequest(context:MutationContext,id:string):Promise<{id:string;unlinked:true}>;
 getFact(id:string):Promise<Fact|null>;
 listFacts(filter?:FactFilter):Promise<Fact[]>;
 listRelationships():Promise<FactRelationship[]>;
}

export interface PendingRequest{request:Extract<Fact,{kind:'request'}>;paidCents:number;pendingCents:number}
export interface FactsSummary{expenseCents:number;paymentCents:number;transferCents:number;totalCents:number;pendingRequests:number}

function parseContext(context:MutationContext){return mutationContextSchema.parse(context);}
function inFilter(fact:Fact,filter:FactFilter):boolean{
 if(filter.from&&fact.occurredAt<filter.from)return false;
 if(filter.to&&fact.occurredAt>filter.to)return false;
 if(filter.kinds&&!filter.kinds.includes(fact.kind))return false;
 if(filter.category&&fact.category!==filter.category)return false;
 if(filter.dependentId&&fact.dependentId!==filter.dependentId)return false;
 if(filter.search){
  const needle=filter.search.toLocaleLowerCase('pt-BR');
  const haystack=[fact.title,fact.notes,fact.sourceDetail??''].join(' ').toLocaleLowerCase('pt-BR');
  if(!haystack.includes(needle))return false;
 }
 return true;
}
function disbursementCents(fact:Fact):number{
 switch(fact.kind){case 'expense':case 'payment':case 'transfer':return fact.amountCents;default:return 0;}
}

export class FactsService{
 constructor(private readonly repository:FactsRepository){}

 async upsertDependent(context:MutationContext,input:DependentInput):Promise<Dependent>{
  const ctx=parseContext(context),data=dependentInputSchema.parse(input),id=data.id??ctx.mutationId;
  return this.repository.upsertDependent(ctx,{id,name:data.name,...(data.birthDate?{birthDate:data.birthDate}:{})});
 }
 async deleteDependent(context:MutationContext,id:string){return this.repository.deleteDependent(parseContext(context),z.uuid().parse(id));}

 private async createFact(context:MutationContext,input:ExpenseInput|PaymentInput|TransferInput|RequestInput|EventInput,kind:Fact['kind']):Promise<Fact>{
  const ctx=parseContext(context),{id:requestedId,...data}=input,id=requestedId??ctx.mutationId;
  return this.repository.createFact(ctx,{...data,id,kind,source:ctx.source,createdBy:ctx.createdBy} as FactCreateRecord);
 }
 async createExpense(context:MutationContext,input:ExpenseInput){return this.createFact(context,expenseInputSchema.parse(input),'expense');}
 async createPayment(context:MutationContext,input:PaymentInput){return this.createFact(context,paymentInputSchema.parse(input),'payment');}
 async createTransfer(context:MutationContext,input:TransferInput){return this.createFact(context,transferInputSchema.parse(input),'transfer');}
 async createRequest(context:MutationContext,input:RequestInput){return this.createFact(context,requestInputSchema.parse(input),'request');}
 async createEvent(context:MutationContext,input:EventInput){return this.createFact(context,eventInputSchema.parse(input),'event');}

 async updateFact(context:MutationContext,id:string,input:FactUpdateInput):Promise<Fact>{
  const ctx=parseContext(context),factId=z.uuid().parse(id),data=factUpdateSchema.parse(input);
  return this.repository.updateFact(ctx,factId,data);
 }
 async deleteFact(context:MutationContext,id:string){return this.repository.deleteFact(parseContext(context),z.uuid().parse(id));}
 async linkDisbursementToRequest(context:MutationContext,input:{id?:string;factId:string;requestId:string}){
  const ctx=parseContext(context),data=z.object({id:z.uuid().optional(),factId:z.uuid(),requestId:z.uuid()}).strict().parse(input);
  return this.repository.linkRequest(ctx,{id:data.id??ctx.mutationId,factId:data.factId,requestId:data.requestId});
 }
 async unlinkDisbursementFromRequest(context:MutationContext,id:string){return this.repository.unlinkRequest(parseContext(context),z.uuid().parse(id));}

 async getDependent(id:string){return this.repository.getDependent(z.uuid().parse(id));}
 async listDependents(){return (await this.repository.listDependents()).sort((a,b)=>a.name.localeCompare(b.name,'pt-BR')||a.id.localeCompare(b.id));}
 async listAudit(filter:AuditFilter={}){
  const parsed=auditFilterSchema.parse(filter),rows=await this.repository.listAudit({...parsed,limit:parsed.limit??100});
  return rows.sort((a,b)=>b.changedAt.localeCompare(a.changedAt));
 }
 async getFact(id:string){return this.repository.getFact(z.uuid().parse(id));}
 async listRelationships(){return this.repository.listRelationships();}
 async listFacts(filter:FactFilter={}):Promise<Fact[]>{
  const parsed=factFilterSchema.parse(filter),rows=await this.repository.listFacts(parsed);
  return rows.filter(fact=>inFilter(fact,parsed)).sort((a,b)=>b.occurredAt.localeCompare(a.occurredAt)||b.createdAt.localeCompare(a.createdAt));
 }
 async searchFacts(search:string,filter:Omit<FactFilter,'search'>={}){return this.listFacts({...filter,search});}

 async getPendingRequests(filter:FactFilter={}):Promise<PendingRequest[]>{
  const parsed=factFilterSchema.parse(filter),facts=await this.repository.listFacts(),relationships=await this.repository.listRelationships();
  const byId=new Map(facts.map(fact=>[fact.id,fact]));
  return facts.filter((fact):fact is Extract<Fact,{kind:'request'}>=>fact.kind==='request'&&inFilter(fact,parsed)).map(request=>{
   const paidCents=relationships.filter(link=>link.requestId===request.id).reduce((sum,link)=>sum+disbursementCents(byId.get(link.factId) as Fact),0);
   return {request,paidCents,pendingCents:Math.max(0,request.amountCents-paidCents)};
  }).filter(item=>item.pendingCents>0);
 }

 async getSummary(filter:FactFilter={}):Promise<FactsSummary>{
  const parsed=factFilterSchema.parse(filter),facts=await this.repository.listFacts(),rows=facts.filter(fact=>inFilter(fact,parsed));
  const expenseCents=rows.filter((fact):fact is Extract<Fact,{kind:'expense'}>=>fact.kind==='expense').reduce((sum,fact)=>sum+fact.amountCents,0);
  const paymentCents=rows.filter((fact):fact is Extract<Fact,{kind:'payment'}>=>fact.kind==='payment').reduce((sum,fact)=>sum+fact.amountCents,0);
  const transferCents=rows.filter((fact):fact is Extract<Fact,{kind:'transfer'}>=>fact.kind==='transfer').reduce((sum,fact)=>sum+fact.amountCents,0);
  return {expenseCents,paymentCents,transferCents,totalCents:expenseCents+paymentCents+transferCents,pendingRequests:(await this.getPendingRequests(parsed)).length};
 }

 async getStatement(filter:FactFilter={}){
  const facts=await this.listFacts(filter);
  return {facts,totalCents:facts.reduce((sum,fact)=>sum+disbursementCents(fact),0)};
 }
 async getReport(filter:FactFilter={}){return {summary:await this.getSummary(filter),statement:await this.getStatement(filter),pendingRequests:await this.getPendingRequests(filter)};}
}
