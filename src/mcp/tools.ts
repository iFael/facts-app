import {z} from 'zod';
import {categorySchema,civilDateSchema,provenanceKindSchema} from '../domain/core.ts';
import {auditFilterSchema,factFilterSchema,type FactsService} from '../service/facts-service.ts';
import {documentInputSchema,evidenceUpdateInputSchema,type FactsDocumentsService} from '../service/documents-service.ts';

export interface FactsToolConfig{
 title:string;
 description:string;
 inputSchema:z.ZodRawShape;
}
export interface FactsToolHost{
 registerTool(name:string,config:FactsToolConfig,handler:(args:unknown)=>Promise<unknown>):void;
}

type ToolResult={content:Array<{type:'text';text:string}>;structuredContent:{result:unknown}};
const money=z.number().int().min(1).max(99999999999);
const transferPurpose=z.enum(['pensao','adicional','reembolso']);
const factBase={
 dependentId:z.uuid(),
 title:z.string().trim().min(1).max(160),
 category:categorySchema,
 notes:z.string().max(10000).default(''),
 occurredAt:civilDateSchema,
 sourceDetail:z.string().trim().min(1).max(100).optional(),
 provenanceKind:provenanceKindSchema.default('user_assertion')
} as const;
const createFactSchema=z.discriminatedUnion('kind',[
 z.object({...factBase,kind:z.literal('expense'),amountCents:money}).strict(),
 z.object({...factBase,kind:z.literal('payment'),amountCents:money}).strict(),
 z.object({...factBase,kind:z.literal('transfer'),amountCents:money,transferPurpose}).strict(),
 z.object({...factBase,kind:z.literal('request'),amountCents:money,requestTotalCents:money.optional()}).strict(),
 z.object({...factBase,kind:z.literal('event')}).strict()
]).superRefine((fact,ctx)=>{
 if(fact.kind==='request'&&fact.requestTotalCents!==undefined&&fact.requestTotalCents<fact.amountCents){
  ctx.addIssue({code:'custom',path:['requestTotalCents'],message:'O total deve ser maior ou igual ao valor solicitado.'});
 }
});
const updateBase={
 title:z.string().trim().min(1).max(160),
 category:categorySchema,
 notes:z.string().max(10000),
 occurredAt:civilDateSchema,
 sourceDetail:z.string().trim().min(1).max(100).optional()
} as const;
const updateFactSchema=z.discriminatedUnion('kind',[
 z.object({...updateBase,kind:z.literal('expense'),amountCents:money}).strict(),
 z.object({...updateBase,kind:z.literal('payment'),amountCents:money}).strict(),
 z.object({...updateBase,kind:z.literal('transfer'),amountCents:money,transferPurpose}).strict(),
 z.object({...updateBase,kind:z.literal('request'),amountCents:money,requestTotalCents:money.optional()}).strict(),
 z.object({...updateBase,kind:z.literal('event')}).strict()
]).superRefine((fact,ctx)=>{
 if(fact.kind==='request'&&fact.requestTotalCents!==undefined&&fact.requestTotalCents<fact.amountCents){
  ctx.addIssue({code:'custom',path:['requestTotalCents'],message:'O total deve ser maior ou igual ao valor solicitado.'});
 }
});
const documentFilterSchema=z.object({factId:z.uuid().optional(),attachmentId:z.uuid().optional()}).strict();

function context(mutationId:string){return {mutationId,source:'chat' as const,createdBy:'assistant' as const};}
function result(value:unknown):ToolResult{return {content:[{type:'text',text:JSON.stringify(value)}],structuredContent:{result:value}};}
function decodeBase64(value:string):Uint8Array{
 try{
  const binary=atob(value),bytes=new Uint8Array(binary.length);
  for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);
  return bytes;
 }catch{throw new Error('contentBase64 inválido.');}
}
function register<T extends z.ZodRawShape>(host:FactsToolHost,name:string,title:string,description:string,shape:T,handler:(args:z.infer<z.ZodObject<T>>)=>Promise<unknown>){
 const schema=z.object(shape).strict();
 host.registerTool(name,{title,description,inputSchema:shape},async raw=>result(await handler(schema.parse(raw))));
}

export function registerFactsTools(host:FactsToolHost,facts:FactsService,documents:FactsDocumentsService):void{
 register(host,'facts_list_dependents','Listar dependentes','Lista os dependentes do usuário autenticado.',{},async()=>facts.listDependents());
 register(host,'facts_get_dependent','Consultar dependente','Consulta um dependente por UUID.',{id:z.uuid()},async({id})=>facts.getDependent(id));
 register(host,'facts_upsert_dependent','Salvar dependente','Cria ou atualiza um dependente. mutationId é obrigatório para idempotência.',{
  mutationId:z.uuid(),id:z.uuid().optional(),name:z.string().trim().min(1).max(100),birthDate:civilDateSchema.optional()
 },async({mutationId,...input})=>facts.upsertDependent(context(mutationId),input));
 register(host,'facts_delete_dependent','Excluir dependente','Exclui um dependente sem fatos vinculados e registra auditoria.',{
  mutationId:z.uuid(),id:z.uuid()
 },async({mutationId,id})=>facts.deleteDependent(context(mutationId),id));

 register(host,'facts_get_fact','Consultar fato','Consulta um fato por UUID.',{id:z.uuid()},async({id})=>facts.getFact(id));
 register(host,'facts_list_facts','Listar fatos','Lista fatos com filtros opcionais, inclusive busca textual.',{filter:factFilterSchema.optional()},async({filter})=>facts.listFacts(filter??{}));
 register(host,'facts_create_fact','Criar fato','Cria Expense, Payment, Transfer, Request ou Event. Valores monetários são centavos inteiros.',{
  mutationId:z.uuid(),fact:createFactSchema
 },async({mutationId,fact})=>{
  switch(fact.kind){
   case 'expense':{const {kind:_,...input}=fact;return facts.createExpense(context(mutationId),input);}
   case 'payment':{const {kind:_,...input}=fact;return facts.createPayment(context(mutationId),input);}
   case 'transfer':{const {kind:_,...input}=fact;return facts.createTransfer(context(mutationId),input);}
   case 'request':{const {kind:_,...input}=fact;return facts.createRequest(context(mutationId),input);}
   case 'event':{const {kind:_,...input}=fact;return facts.createEvent(context(mutationId),input);}
  }
 });
 register(host,'facts_update_fact','Atualizar fato','Substitui os campos editáveis de um fato existente e registra auditoria.',{
  mutationId:z.uuid(),id:z.uuid(),fact:updateFactSchema
 },async({mutationId,id,fact})=>facts.updateFact(context(mutationId),id,fact));
 register(host,'facts_delete_fact','Excluir fato','Exclui um fato quando a integridade referencial permitir e registra auditoria.',{
  mutationId:z.uuid(),id:z.uuid()
 },async({mutationId,id})=>facts.deleteFact(context(mutationId),id));

 register(host,'facts_link_disbursement_to_request','Vincular desembolso','Vincula Expense, Payment ou Transfer a uma Request.',{
  mutationId:z.uuid(),factId:z.uuid(),requestId:z.uuid(),id:z.uuid().optional()
 },async({mutationId,...input})=>facts.linkDisbursementToRequest(context(mutationId),input));
 register(host,'facts_unlink_disbursement_from_request','Desvincular desembolso','Remove um vínculo fulfills_request por UUID.',{
  mutationId:z.uuid(),id:z.uuid()
 },async({mutationId,id})=>facts.unlinkDisbursementFromRequest(context(mutationId),id));

 register(host,'facts_get_summary','Resumo financeiro','Retorna totais de Expense, Payment, Transfer e quantidade de solicitações pendentes.',{filter:factFilterSchema.optional()},async({filter})=>facts.getSummary(filter??{}));
 register(host,'facts_get_statement','Extrato','Retorna fatos e total de desembolsos no período/filtros informados.',{filter:factFilterSchema.optional()},async({filter})=>facts.getStatement(filter??{}));
 register(host,'facts_get_pending_requests','Solicitações pendentes','Retorna solicitações ainda não integralmente atendidas.',{filter:factFilterSchema.optional()},async({filter})=>facts.getPendingRequests(filter??{}));
 register(host,'facts_get_report','Relatório','Retorna resumo, extrato e solicitações pendentes em uma única leitura.',{filter:factFilterSchema.optional()},async({filter})=>facts.getReport(filter??{}));
 register(host,'facts_list_audit','Auditoria','Lista alterações auditadas com filtros opcionais; limite máximo 200.',{filter:auditFilterSchema.optional()},async({filter})=>facts.listAudit(filter??{}));

 register(host,'facts_list_documents','Listar documentos','Lista Attachment + Evidence, opcionalmente filtrando por fato ou attachment.',{filter:documentFilterSchema.optional()},async({filter})=>documents.listDocuments(filter??{}));
 register(host,'facts_get_evidence','Consultar evidência','Consulta Evidence por UUID, incluindo texto extraído, interpretação e vínculos.',{id:z.uuid()},async({id})=>documents.getEvidence(id));
 register(host,'facts_ingest_document','Ingerir documento','Registra arquivo original privado + Evidence em uma mutação idempotente. contentBase64 contém os bytes originais.',{
  mutationId:z.uuid(),document:documentInputSchema,contentBase64:z.string().min(1).max(28_000_000)
 },async({mutationId,document,contentBase64})=>documents.ingestDocument(context(mutationId),document,decodeBase64(contentBase64)));
 register(host,'facts_update_evidence','Atualizar evidência','Atualiza derivados e vínculos da Evidence sem alterar o arquivo original.',{
  mutationId:z.uuid(),id:z.uuid(),evidence:evidenceUpdateInputSchema
 },async({mutationId,id,evidence})=>documents.updateEvidence(context(mutationId),id,evidence));
 register(host,'facts_delete_document','Excluir documento','Exclui Evidence, vínculos, metadata e depois o objeto privado do Storage.',{
  mutationId:z.uuid(),evidenceId:z.uuid()
 },async({mutationId,evidenceId})=>documents.deleteDocument(context(mutationId),evidenceId));
}
