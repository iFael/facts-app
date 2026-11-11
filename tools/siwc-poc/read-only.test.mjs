import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readIntent,callNativeReadTool,compactReport,compactAudit,collectFactsReadContext} from './read-only.mjs';

test('intenções em português encaminham apenas a consultas conhecidas',()=>{
 assert.equal(readIntent('Faça uma bateria de testes e verifique a sincronização'),'diagnostics');
 assert.equal(readIntent('Quais documentos e comprovantes existem?'),'documents');
 assert.equal(readIntent('Investigue a categoria Vestuário'),'category');
 assert.equal(readIntent('Mostre o histórico de alterações'),'audit');
 assert.equal(readIntent('Relatório dos pagamentos do Noah'),'report');
 assert.equal(readIntent('Oi, tudo bem?'),null);
});

test('MCP bloqueia operações de escrita e destinos externos antes de qualquer rede',async()=>{
 let called=false;
 const fetcher=()=>{called=true;throw Error('network must not be called');};
 await assert.rejects(()=>callNativeReadTool({
  url:'https://gpbsjmagjxpnoooldgtk.supabase.co',key:'public',token:'jwt',
  name:'facts_create_fact',fetcher,
 }),/não autorizada/);
 await assert.rejects(()=>callNativeReadTool({
  url:'https://example.net',key:'public',token:'jwt',
  name:'facts_get_report',fetcher,
 }),/inesperado/);
 assert.equal(called,false);
});

test('MCP faz tools/call nativo em leitura, sem imprimir credenciais',async()=>{
 let request;
 const fetcher=async (_url,options)=>{
  request=options;
  return {ok:true,text:async()=>JSON.stringify({
   jsonrpc:'2.0',id:1,result:{structuredContent:{result:{summary:{test:true}}}},
  })};
 };
 const out=await callNativeReadTool({
  url:'https://gpbsjmagjxpnoooldgtk.supabase.co',
  key:'public-key',token:'private-token',name:'facts_get_report',
  args:{filter:{from:'2026-11-01',to:'2026-11-11'}},fetcher,
 });
 assert.equal(out.summary.test,true);
 assert.equal(JSON.parse(request.body).params.name,'facts_get_report');
 assert.equal(request.headers.Authorization,'Bearer private-token');
 assert.equal(JSON.parse(request.body).params.arguments.filter.from,'2026-11-01');
});

test('relatório e auditoria sanitizam detalhes e respeitam limites',()=>{
 const fact=Object.freeze({
  kind:'payment',occurredAt:'2026-11-10',title:'Pagamento confirmado',
  notes:'DADOS PRIVADOS NÃO DEVEM SAIR',category:'outros',amountCents:80000,
 });
 const report=compactReport({
  summary:{expenseCents:0,paymentCents:80000,transferCents:0,totalCents:80000,pendingRequests:0},
  statement:{facts:Array.from({length:32},()=>fact)},
  pendingRequests:[],
 },'2026-11-01','2026-11-11');
 assert.equal(report.recordedFactsCount,32);
 assert.equal(report.recentFacts.length,15);
 assert.equal(report.recentFacts[0].amountCents,80000);
 assert.equal(JSON.stringify(report).includes('DADOS PRIVADOS'),false);
 const audit=compactAudit(Array.from({length:23},()=>({
  entityType:'fact',action:'update',changedAt:'2026-11-10',before:{secret:'private'},
 })));
 assert.equal(audit.recentChanges.length,20);
 assert.equal(JSON.stringify(audit).includes('private'),false);
});

test('perguntas livres não fazem consultas adicionais nem solicitações de escrita',async()=>{
 let touched=false;
 const client={auth:{getSession:()=>{touched=true;return {data:{session:null}};}}};
 const got=await collectFactsReadContext({
  question:'Olá!',client,ownerId:'id',
  url:'https://gpbsjmagjxpnoooldgtk.supabase.co',key:'k',
 });
 assert.equal(got,null);
 assert.equal(touched,false);
});



test('investigação de categoria usa apenas lançamentos POSTED do próprio usuário',async()=>{
 const filters=[];
 const data=[{
  occurred_at:'2026-11-09',amount_cents:150000,direction:'outgoing',
  institution:'Mercado Pago',description:'Compra registrada',merchant_name:null,
  counterparty_name:'NÃO VAZAR',
 }];
 const client={
  auth:{getSession:async()=>({data:{session:{access_token:'token'}}})},
  from(table){
   assert.equal(table,'facts_bank_transactions');
   const q={
    select(){return this},eq(...args){filters.push(args);return this},
    gte(){return this},lte(){return this},order(){return this},
    limit:async n=>{assert.equal(n,30);return {data,count:1,error:null};},
   };
   return q;
  },
 };
 const result=await collectFactsReadContext({
  question:'Investigue a categoria Vestuário',client,ownerId:'owner-id',
  url:'https://gpbsjmagjxpnoooldgtk.supabase.co',key:'k',
  bankSummary:{from:'2026-09-27',to:'2026-11-11',groups:[{category:'Clothing'}]},
  readTool:async()=>{throw Error('MCP não necessário para o drilldown');},
 });
 assert.equal(result.intent,'category');
 assert.equal(result.category.matchedCategory,'Clothing');
 assert.equal(result.category.complete,true);
 assert.equal(result.category.rows[0].amountCents,150000);
 assert.equal(filters.some(x=>x[0]==='owner_id'&&x[1]==='owner-id'),true);
 assert.equal(filters.some(x=>x[0]==='tx_status'&&x[1]==='POSTED'),true);
 assert.equal(JSON.stringify(result).includes('NÃO VAZAR'),false);
});

test('diagnóstico consulta MCP e a Central de Conciliação, sem executar mutações',async()=>{
 const methods=[],tables=[];
 function query(name){
  const data=name==='facts_bank_settings'?{last_synced_at:'2026-11-11T11:00:00Z'}:
   name==='facts_bank_transactions'?[{occurred_at:'2026-11-11'}]:null;
  const q={
   select(){return this},eq(){return this},order(){return this},
   maybeSingle:async()=>({data,error:null}),
   limit:async()=>({data,error:null}),
   then(resolve,reject){
    return Promise.resolve({
     data:null,count:name==='facts_bank_reviews'?2:150,error:null,
    }).then(resolve,reject);
   },
  };
  return q;
 }
 const client={
  auth:{getSession:async()=>({data:{session:{access_token:'fake'}}})},
  from(table){tables.push(table);return query(table);},
 };
 const out=await collectFactsReadContext({
  question:'Verifique integracoes e sincronizacao',
  client,ownerId:'owner',
  url:'https://gpbsjmagjxpnoooldgtk.supabase.co',key:'k',
  now:new Date('2026-11-11T12:00:00Z'),
  readTool:async ({name})=>{
   methods.push(name);
   if(name==='facts_get_report')return {
    summary:{expenseCents:0,paymentCents:0,transferCents:0,totalCents:0,pendingRequests:0},
    statement:{facts:[]},pendingRequests:[],
   };
   return [];
  },
 });
 assert.deepEqual(methods,['facts_get_report','facts_list_documents','facts_list_audit']);
 assert.equal(tables.length,4);
 assert.equal(out.banking.pendingReviews,2);
 assert.equal(out.banking.bankTransactionsTotal,150);
 assert.equal(out.banking.lastReconciliationRecordedAt,'2026-11-11T11:00:00Z');
 assert.equal(JSON.stringify(out).includes('fake'),false);
});

test('relatório chama apenas a leitura nativa do MCP e indica escopo',async()=>{
 const called=[];
 const client={auth:{getSession:async()=>({data:{session:{access_token:'fake'}}})}};
 const result=await collectFactsReadContext({
  question:'Relatório de gastos',client,ownerId:'owner',
  url:'https://gpbsjmagjxpnoooldgtk.supabase.co',key:'k',
  now:new Date('2026-11-11T12:00:00.000Z'),
  readTool:async args=>{
   called.push(args.name);
   return {summary:{expenseCents:10,paymentCents:20,transferCents:30,totalCents:60,pendingRequests:0},statement:{facts:[]},pendingRequests:[]};
  },
 });
 assert.deepEqual(called,['facts_get_report']);
 assert.equal(result.source,'facts_readonly');
 assert.equal(result.report.summary.totalCents,60);
 assert.equal(result.report.to,'2026-11-11');
});
