/**
 * Consultas deliberadamente limitadas ao MCP nativo do Facts e a indicadores
 * operacionais que a própria Central de Conciliação já lê. Nunca há escrita.
 */
const tools=new Set(['facts_get_report','facts_list_documents','facts_list_audit']);
const maxResponseBytes=250_000;

function normalize(value){
 return value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
}
export function readIntent(question){
 const q=normalize(question);
 if(/\b(diagnostic|verific|chec|test|sincroniz|integrac|saude do app|funcionando|status do app|auditoria geral)\w*/.test(q))
  return 'diagnostics';
 if(/\b(comprov|document|anex|evidenc)\w*/.test(q))return 'documents';
 if(/\b(auditor|alterac|quem alterou|historico de mudanc)\w*/.test(q))return 'audit';
 if(/\b(categor|classific|vestuar|duplicid)\w*/.test(q))return 'category';
 if(/\b(relator|extrat|despes|gast|pagament|pensao|noah|solicit|fato|registr)\w*/.test(q))
  return 'report';
 return null;
}

function httpJsonRpc(url,key,token,name,args,fetcher){
 if(!tools.has(name))throw Error('Ferramenta não autorizada para leitura.');
 const origin=new URL(url);
 if(origin.protocol!=='https:'||origin.hostname!=='gpbsjmagjxpnoooldgtk.supabase.co'||
    origin.username||origin.password||origin.port||origin.search||origin.hash||
    !['','/'].includes(origin.pathname))
  throw Error('Servidor Facts inesperado.');
 return fetcher(origin.origin+'/functions/v1/facts-mcp',{
  method:'POST',
  headers:{
   'Content-Type':'application/json',
   Accept:'application/json, text/event-stream',
   'MCP-Protocol-Version':'2025-03-26',
   apikey:key,
   Authorization:'Bearer '+token,
  },
  body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',
   params:{name,arguments:args}}),
  signal:AbortSignal.timeout(20_000),
 });
}

export async function callNativeReadTool({url,key,token,name,args={},fetcher=fetch}){
 const response=await httpJsonRpc(url,key,token,name,args,fetcher);
 if(!response.ok)throw Error('Consulta MCP indisponível (HTTP '+response.status+').');
 const raw=await response.text();
 if(raw.length>maxResponseBytes)throw Error('Resposta MCP excede o limite.');
 let parsed;
 try{parsed=JSON.parse(raw);}catch{throw Error('Resposta MCP inválida.');}
 if(parsed.error||parsed.result?.isError)throw Error('Consulta MCP rejeitada pelo Facts.');
 const value=parsed.result?.structuredContent?.result;
 if(value===undefined)throw Error('Resultado MCP sem dados estruturados.');
 return value;
}

function integer(value){
 return Number.isSafeInteger(value)&&value>=0?value:null;
}
function text(value,max=140){
 return typeof value==='string'?value.trim().slice(0,max):null;
}
function recentFacts(facts){
 return facts.slice(0,15).map(fact=>({
  type:text(fact.kind,20),date:text(fact.occurredAt,10),
  title:text(fact.title,100),category:text(fact.category,35),
  amountCents:integer(fact.amountCents),
 }));
}
export function compactReport(report,from,to){
 if(!report||typeof report!=='object'||!report.summary||
  !report.statement||!Array.isArray(report.statement.facts)||
  !Array.isArray(report.pendingRequests))throw Error('Contrato de relatório Facts inválido.');
 const s=report.summary;
 return {
  source:'facts_get_report',from,to,
  summary:{
   expenseCents:integer(s.expenseCents),
   paymentCents:integer(s.paymentCents),
   transferCents:integer(s.transferCents),
   totalCents:integer(s.totalCents),
   pendingRequests:integer(s.pendingRequests),
  },
  recordedFactsCount:report.statement.facts.length,
  recentFacts:recentFacts(report.statement.facts),
  pendingRequestsCount:report.pendingRequests.length,
  caveat:'Valores do domínio Facts, não movimentações bancárias Pluggy. Não somar as duas fontes sem conciliação.',
 };
}

export function compactAudit(rows){
 if(!Array.isArray(rows))throw Error('Contrato de auditoria Facts inválido.');
 return {
  source:'facts_list_audit',returnedChanges:rows.length,limit:20,
  recentChanges:rows.slice(0,20).map(row=>({
   type:text(row.entityType,30),action:text(row.action,20),
   changedAt:text(row.changedAt,30),
  })),
  caveat:'Somente as últimas 20 entradas de auditoria; não representa o histórico completo.',
 };
}

function compactDocuments(rows){
 if(!Array.isArray(rows))throw Error('Contrato de documentos Facts inválido.');
 return {
  source:'facts_list_documents',documentsCount:rows.length,
  caveat:'Listagem de metadados; não houve abertura do arquivo original nem validação dos bytes.',
 };
}

async function bankDiagnostics(client,ownerId){
 const [settings,bank,reviews,recent]=await Promise.all([
  client.from('facts_bank_settings').select('last_synced_at').eq('owner_id',ownerId).maybeSingle(),
  client.from('facts_bank_transactions').select('id',{head:true,count:'exact'}).eq('owner_id',ownerId),
  client.from('facts_bank_reviews').select('id',{head:true,count:'exact'}).eq('owner_id',ownerId).eq('status','pending'),
  client.from('facts_bank_transactions').select('occurred_at').eq('owner_id',ownerId)
   .order('occurred_at',{ascending:false}).limit(1),
 ]);
 if(settings.error||bank.error||reviews.error||recent.error)
  throw Error('Consulta dos indicadores de conciliação indisponível.');
 return {
  source:'facts_bank_settings + facts_bank_transactions + facts_bank_reviews',
  lastReconciliationRecordedAt:text(settings.data?.last_synced_at,40),
  bankTransactionsTotal:integer(bank.count),
  pendingReviews:integer(reviews.count),
  latestTransactionDate:text(recent.data?.[0]?.occurred_at,10),
  caveat:'Última conciliação registrada e data do lançamento NÃO comprovam que a Pluggy ou os bancos estejam sincronizados agora.',
 };
}

async function categoryDiagnostics(client,ownerId,question,bankSummary){
 if(!Array.isArray(bankSummary?.groups))throw Error('Resumo bancário indisponível.');
 const normalized=normalize(question);
 const categories=[...new Set(bankSummary.groups.map(row=>row.category))]
  .filter(label=>typeof label==='string'&&label!=='não informada')
  .sort((a,b)=>b.length-a.length);
 const direct=categories.find(label=>label.length>=3&&normalized.includes(normalize(label)));
 // Only one observed Pluggy label has a verified local translation.
 const alias=[['vestuario','Clothing'],['roupas','Clothing']]
  .find(([term,target])=>normalized.includes(term)&&categories.includes(target));
 const category=direct??alias?.[1];
 if(!category)return {
  source:'facts_bank_transactions',matchedCategory:null,
  caveat:'Nenhuma categoria específica reconhecida na pergunta. Solicite o nome da categoria presente no extrato.',
 };
 const from=bankSummary.from,to=bankSummary.to;
 const {data,count,error}=await client.from('facts_bank_transactions')
  .select('occurred_at,amount_cents,direction,institution,category,description,merchant_name',{count:'exact'})
  .eq('owner_id',ownerId).eq('tx_status','POSTED').eq('foreign_charge',false)
  .eq('category',category).gte('occurred_at',from).lte('occurred_at',to)
  .order('occurred_at',{ascending:false}).limit(30);
 if(error||count===null)throw Error('Detalhamento de categoria indisponível.');
 return {
  source:'facts_bank_transactions',matchedCategory:category,from,to,
  totalMatchedRows:count,returnedRows:(data??[]).length,
  complete:count===(data??[]).length,
  rows:(data??[]).map(row=>({
   date:text(row.occurred_at,10),amountCents:integer(row.amount_cents),
   direction:text(row.direction,10),institution:text(row.institution,60),
   description:text(row.description,100),merchant:text(row.merchant_name,70),
  })),
  caveat:'Até 30 movimentações POSTED desse período. Descrição e categoria vêm do registro; não comprovam a natureza da despesa nem autorizam reclassificação automática.',
 };
}

function dateRange(now){
 const to=new Intl.DateTimeFormat('sv-SE',{
  timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit',
 }).format(now);
 const from=new Date(now.getTime()-45*86_400_000).toISOString().slice(0,10);
 return {from,to};
}

/**
 * O texto do usuário escolhe apenas uma operação permitida; jamais vira nome
 * de ferramenta, parâmetros livres, SQL, RPC arbitrária ou escrita.
 */
export async function collectFactsReadContext({question,client,ownerId,url,key,bankSummary,now=new Date(),readTool=callNativeReadTool}){
 const intent=readIntent(question);
 if(!intent)return null;
 const {data:{session},error}=await client.auth.getSession();
 if(error||!session?.access_token)throw Error('Sessão Facts necessária para consulta.');
 const invoke=(name,args)=>readTool({url,key,token:session.access_token,name,args});
 const period=dateRange(now);
 const evidence={source:'facts_readonly',intent,checkedAt:now.toISOString(),
  scope:'Dados do próprio usuário, em leitura, protegidos por RLS.'};
 if(intent==='report'||intent==='diagnostics'){
  evidence.report=compactReport(await invoke('facts_get_report',{filter:period}),period.from,period.to);
 }
 if(intent==='documents'||intent==='diagnostics')
  evidence.documents=compactDocuments(await invoke('facts_list_documents',{}));
 if(intent==='audit'||intent==='diagnostics')
  evidence.audit=compactAudit(await invoke('facts_list_audit',{filter:{limit:20}}));
 if(intent==='diagnostics')
  evidence.banking=await bankDiagnostics(client,ownerId);
 if(intent==='category')
  evidence.category=await categoryDiagnostics(client,ownerId,question,bankSummary);
 return evidence;
}
