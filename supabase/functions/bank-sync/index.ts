import { createClient } from 'npm:@supabase/supabase-js@2.116.0';
import { z } from 'npm:zod@4.6.4';
import { FactsPluggyClient } from '../_shared/pluggy.ts';
import { mapPluggyTransaction } from '../../../src/bank/pluggy-mapper.ts';
import {
  isPostedTransaction, matchRecipient, moneyToCents, normalizeBankText,
  overlapStart, planAgataTransfer, probableNoahExpense, signedMoneyToCents,
  type BankFeedTransaction, type RecipientRule,
} from '../../../src/bank/automation.ts';

const RESEND_API='https://api.resend.com/emails';
const FACTS_URL = 'https://facts-app-nu.vercel.app/';
const jsonHeaders = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
const datePattern = /^\d{4}-\d{2}-\d{2}$/;

const ruleSchema = z.object({
  ownerId: z.string().uuid(), dependentId: z.string().uuid(),
  canonicalName: z.string().min(1), normalizedName: z.string().min(1),
  pensionAmountCents: z.number().int().positive(),
  pensionDayStart: z.number().int().min(1).max(31),
  pensionDayEnd: z.number().int().min(1).max(31),
  importFrom: z.string().regex(datePattern),
});
const settingSchema = z.object({
  ownerId: z.string().uuid(), dependentId: z.string().uuid(),
  ledgerFrom: z.string().regex(datePattern), notifyFrom: z.string().regex(datePattern),
  lastSyncedAt: z.string().nullable().optional(),
});
const learningSchema = z.object({
  ownerId: z.string().uuid(), dependentId: z.string().uuid(),
  matchKind: z.enum(['merchant','counterparty']),
  matchValue: z.string().min(1), direction: z.enum(['outgoing','incoming']).nullable(),
  action: z.enum(['noah_expense','ignore']), category: z.string().nullable(),
});
const connectionSchema=z.object({
  ownerId:z.string().uuid(),itemId:z.string().uuid(),
  institution:z.string().nullable(),status:z.literal('active'),
  lastSyncedAt:z.string().nullable(),
});
const configSchema = z.object({
  clientId:z.string().nullable(),clientSecret:z.string().nullable(),
  webhookSecret:z.string().min(16),cronSecret:z.string().min(16),
  emailKey:z.string().nullable(),emailTo:z.string().nullable(),emailFrom:z.string().nullable(),
  settings:z.array(settingSchema),rules:z.array(ruleSchema),
  learningRules:z.array(learningSchema),connections:z.array(connectionSchema),
});
type MailConfiguration={key:string;recipient:string;sender:string};
type DbClient = ReturnType<typeof createClient>;
type LedgerResult = {
  id: string; providerId: string; new: boolean; changed: boolean;
  factId: string | null; syncState: string; relevance: string;
};
type Summary = {
  seen: number; ledger: number; imported: number; linkedExisting: number;
  replayed: number; needsReview: number; newReviews: number;
  notificationsSent: number; notificationsFailed: number; insightsQueued: number; insightsSent: number; insightsFailed: number; skipped: number;
};

function response(body: unknown, status=200): Response {
  return new Response(JSON.stringify(body), {status,headers:jsonHeaders});
}
function safeEqual(left: string,right: string): boolean {
  if (left.length !== right.length) return false;
  let diff=0;
  for (let i=0;i<left.length;i++) diff|=left.charCodeAt(i)^right.charCodeAt(i);
  return diff===0;
}
function direction(type: string | null): 'outgoing'|'incoming'|'unknown' {
  const value=type?.toUpperCase();
  return value==='DEBIT'?'outgoing':value==='CREDIT'?'incoming':'unknown';
}
function monthStart(date: string): string {return date.slice(0,7)+'-01';}
function monthEnd(month: string): string {
  const date=new Date(month+'T00:00:00.000Z');
  date.setUTCMonth(date.getUTCMonth()+1);
  return date.toISOString().slice(0,10);
}


function businessDate():string{
  return new Intl.DateTimeFormat('sv-SE',{timeZone:'America/Sao_Paulo'}).format(new Date());
}
async function sendFactsEmail(
  config:MailConfiguration,id:string,subject:string,body:string,
):Promise<void>{
  const r=await fetch(RESEND_API,{
    method:'POST',headers:{
      Authorization:'Bearer '+config.key,
      'Content-Type':'application/json','Idempotency-Key':'facts-'+id,
    },
    body:JSON.stringify({from:config.sender,to:[config.recipient],subject,text:body}),
    signal:AbortSignal.timeout(12000),
  });
  if(!r.ok)throw Error('email_http_'+r.status);
}
function notificationText(
  kind:string,bank:Record<string,unknown>,reason:string|null,reviewId:string|null,
):{subject:string;body:string}{
  const cents=Number(bank.amount_cents??0);
  const amount=new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(cents/100);
  const date=String(bank.occurred_at??'').split('-').reverse().join('/');
  const direction=bank.direction==='incoming'?'recebido':'enviado';
  return{
    subject:kind==='bank_review'?'Facts — confirmação necessária: '+amount:'Facts — movimentação reconhecida: '+amount,
    body:[
      kind==='bank_review'?'Uma movimentação precisa da sua confirmação.':'Uma movimentação foi conciliada.',
      'Valor: '+amount,'Data: '+date,'Movimento: '+direction,
      'Instituição: '+String(bank.institution??'não informada'),
      'Contraparte: '+String(bank.counterparty_name??'não identificada'),
      'Descrição: '+String(bank.description??'não informada'),
      reason?'Motivo da revisão: '+reason:null,
      reviewId?'Revisar no Facts: '+FACTS_URL+'?review='+encodeURIComponent(reviewId):
        'Abrir Facts: '+FACTS_URL+'?bank=1',
    ].filter(Boolean).join('\n'),
  };
}

async function storePage(admin:DbClient,ownerId:string,rows:BankFeedTransaction[]):Promise<LedgerResult[]>{
  const results:LedgerResult[]=[];
  for(let offset=0;offset<rows.length;offset+=200){
    const batch=rows.slice(offset,offset+200).flatMap((tx)=>{
      const amountCents=moneyToCents(tx.amount);
      if(!amountCents)return [];
      return [{
        id:tx.id,itemId:tx.itemId,accountId:tx.accountId,
        occurredAt:tx.chargeDate,amountCents,originalAmountCents:signedMoneyToCents(tx.originalAmount),
        direction:direction(tx.type),description:tx.descriptionRaw??tx.description,
        txType:tx.type,txStatus:tx.status,operationType:tx.operationType,
        paymentMethod:tx.paymentMethod,counterpartyName:tx.counterpartyName,
        counterpartyKind:tx.counterpartyKind,merchantName:tx.merchantName,
        institution:tx.institution,category:tx.category,foreignCharge:tx.foreignCharge,
      }];
    });
    if(!batch.length)continue;
    const {data,error}=await admin.rpc('facts_upsert_bank_ledger',{p_owner_id:ownerId,p_entries:batch});
    if(error)throw Error('ledger_upsert_'+(error.code??'unknown'));
    const items=data?.items;
    if(!Array.isArray(items))throw Error('ledger_response_invalid');
    results.push(...items as LedgerResult[]);
  }
  return results;
}

async function updateRelevance(admin:DbClient,id:string,relevance:'agata'|'noah'|'irrelevant',confidence:number,source?:string){
  const values:Record<string,unknown>={relevance,relevance_confidence:confidence,updated_at:new Date().toISOString()};
  if(source)values.match_source=source;
  const {error}=await admin.from('facts_bank_transactions').update(values).eq('id',id);
  if(error)throw Error('relevance_update_'+(error.code??'unknown'));
}

async function queueReview(admin:DbClient,ownerId:string,bankId:string,dependentId:string,
 reason:string,action:string,summary:Summary){
  const {data,error}=await admin.rpc('facts_queue_bank_review',{
    p_owner:ownerId,p_transaction:bankId,p_dependent:dependentId,
    p_reason:reason,p_action:action,
  });
  if(error)throw Error('review_queue_'+(error.code??'unknown'));
  if(data)summary.newReviews++;
  summary.needsReview++;
}

async function queueEvent(admin:DbClient,ownerId:string,bankId:string){
  const {error}=await admin.rpc('facts_queue_bank_event',{p_owner:ownerId,p_transaction:bankId});
  if(error)throw Error('event_queue_'+(error.code??'unknown'));
}

async function processEntries(
  admin:DbClient,settings:z.infer<typeof settingSchema>,
  rules:RecipientRule[],learning:z.infer<typeof learningSchema>[],
  transactions:BankFeedTransaction[],stored:LedgerResult[],summary:Summary,today:string,
  pensionMonths:Set<string>,knownPensions:{id:string;occurred_at:string;amount_cents:number}[],
  linkedIds:Set<string>,
){
  const index=new Map(stored.map((item)=>[item.providerId,item]));
  for(const tx of transactions){
    const bank=index.get(tx.id);
    if(!bank)continue;
    summary.ledger++;
    if(tx.chargeDate>today||!isPostedTransaction(tx)){summary.skipped++;continue;}
    const dir=direction(tx.type);
    if(bank.changed){summary.needsReview++;continue;}
    const matchedRule=rules.find((rule)=>matchRecipient(tx,rule));
    if(matchedRule){
      const match=matchRecipient(tx,matchedRule);
      if(match)await updateRelevance(admin,bank.id,'agata',100,match);
      if(bank.factId){summary.replayed++;continue;}
      if(bank.syncState==='reviewed')continue;
      const month=monthStart(tx.chargeDate);
      const exact=knownPensions.find((p)=>p.occurred_at===tx.chargeDate
        && Number(p.amount_cents)===moneyToCents(tx.amount));
      const alreadyLinked=exact?linkedIds.has(exact.id):false;
      const proposal=planAgataTransfer(tx,matchedRule,pensionMonths.has(month),Boolean(exact)&&!alreadyLinked);
      if(alreadyLinked){
        await queueReview(admin,settings.ownerId,bank.id,matchedRule.dependentId,
          'pension_duplicate_month','adicional',summary);
        continue;
      }
      if(proposal.type==='auto_pension'&&dir==='outgoing'){
        const {data,error}=await admin.rpc('facts_import_bank_transaction',{
          p_owner_id:settings.ownerId,p_dependent_id:matchedRule.dependentId,
          p_provider_transaction_id:tx.id,p_item_id:tx.itemId,p_account_id:tx.accountId,
          p_occurred_at:tx.chargeDate,p_amount_cents:moneyToCents(tx.amount),
          p_original_amount_cents:signedMoneyToCents(tx.originalAmount),
          p_description:tx.descriptionRaw??tx.description,p_tx_type:tx.type,
          p_operation_type:tx.operationType,p_tx_status:tx.status,
          p_payment_method:tx.paymentMethod,p_counterparty_name:tx.counterpartyName??matchedRule.canonicalName,
          p_match_source:match,p_transfer_purpose:'pensao',p_source_detail:'Pluggy — Ciclo',
        });
        if(error)throw Error('pension_import_'+(error.code??'unknown'));
        if(data?.status==='imported')summary.imported++;
        else if(data?.status==='linked_existing')summary.linkedExisting++;
        else if(data?.status==='needs_review'){
          await queueReview(admin,settings.ownerId,bank.id,matchedRule.dependentId,
            'pension_duplicate_month','pensao',summary);
          continue;
        }else summary.replayed++;
        pensionMonths.add(month);
        if(typeof data?.factId==='string')linkedIds.add(data.factId);
        if(bank.new)await queueEvent(admin,settings.ownerId,bank.id);
      } else if(proposal.type==='review'){
        await queueReview(admin,settings.ownerId,bank.id,matchedRule.dependentId,
          proposal.reason,proposal.suggested,summary);
      }
      continue;
    }
    if(dir!=='outgoing')continue;
    if(bank.factId||bank.syncState==='reviewed'||bank.relevance==='irrelevant')continue;
    const merchant=tx.merchantName?normalizeBankText(tx.merchantName):'';
    const learned=merchant?learning.find((rule)=>rule.ownerId===settings.ownerId
      && rule.matchKind==='merchant'&&rule.matchValue===merchant
      && rule.direction==='outgoing'):undefined;
    if(learned?.action==='ignore'){
      await updateRelevance(admin,bank.id,'irrelevant',100);
      continue;
    }
    if(learned?.action==='noah_expense'){
      const {data,error}=await admin.rpc('facts_auto_book_noah_expense',{
        p_owner:settings.ownerId,p_transaction:bank.id,p_merchant_key:merchant,
      });
      if(error)throw Error('noah_auto_'+(error.code??'unknown'));
      if(data?.status==='imported'){
        summary.imported++;
        await queueEvent(admin,settings.ownerId,bank.id);
      }else summary.replayed++;
      continue;
    }
    if(tx.chargeDate>=settings.notifyFrom&&probableNoahExpense(tx)){
      await updateRelevance(admin,bank.id,'noah',45);
      await queueReview(admin,settings.ownerId,bank.id,settings.dependentId,
        'possible_noah_expense','noah_expense',summary);
    }
  }
}


async function flushNotifications(admin:DbClient,mail:MailConfiguration|null,summary:Summary){
  if(!mail)return;
  const {data,error}=await admin.rpc('facts_claim_bank_notifications',{p_limit:20});
  if(error)throw Error('notification_claim_'+(error.code??'unknown'));
  for(const job of (Array.isArray(data)?data:[])){
    try{
      const {data:bank,error:bankError}=await admin.from('facts_bank_transactions')
        .select('*').eq('id',job.transaction_id).eq('owner_id',job.owner_id).single();
      if(bankError||!bank)throw Error('notification_bank_missing');
      let reviewId:string|null=null;
      let reason:string|null=null;
      if(job.kind==='bank_review'){
        const {data:review,error:reviewError}=await admin.from('facts_bank_reviews')
          .select('id,reason,status').eq('owner_id',job.owner_id)
          .eq('transaction_id',job.transaction_id).maybeSingle();
        if(reviewError)throw Error('notification_review_read');
        if(!review||review.status!=='pending'){
          const {error:skipError}=await admin.from('facts_bank_notifications').update({
            status:'sent',sent_at:new Date().toISOString(),updated_at:new Date().toISOString(),
          }).eq('id',job.id);
          if(skipError)throw Error('notification_skip_'+skipError.code);
          continue;
        }
        reviewId=review.id;reason=review.reason;
      }
      const message=notificationText(job.kind,bank,reason,reviewId);
      await sendFactsEmail(mail,job.id,message.subject,message.body);
      const {error:markError}=await admin.from('facts_bank_notifications').update({
        status:'sent',sent_at:new Date().toISOString(),updated_at:new Date().toISOString(),last_error_code:null,
      }).eq('id',job.id);
      if(markError)throw Error('notification_mark_sent_'+markError.code);
      summary.notificationsSent++;
    }catch(err){
      const failure=err instanceof Error?err.message:'notification_failed';
      summary.notificationsFailed++;
      const {error:markError}=await admin.from('facts_bank_notifications')
        .update({status:'failed',last_error_code:failure.slice(0,100),updated_at:new Date().toISOString()})
        .eq('id',job.id);
      if(markError)console.error('bank-sync notification_state_failure',markError.code);
    }
  }
}
const categoryLabels:Record<string,string>={
 alimentacao:'Alimentação',saude:'Saúde',vestuario:'Vestuário',
 transporte:'Transporte',higiene:'Higiene',educacao:'Educação',lazer:'Lazer',outros:'Outros',
};
async function flushMonthlyInsights(admin:DbClient,mail:MailConfiguration|null,summary:Summary){
 if(!mail)return;
 const {data,error}=await admin.rpc('facts_claim_monthly_insights',{p_limit:10});
 if(error)throw Error('monthly_insights_claim_'+(error.code??'unknown'));
 for(const alert of (Array.isArray(data)?data:[])){
  try{
   const current=Number(alert.current_cents),previous=Number(alert.previous_cents);
   const format=(cents:number)=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(cents/100);
   const label=categoryLabels[alert.category]??alert.category;
   const percent=Math.round((current-previous)/previous*100);
   await sendFactsEmail(
     mail,alert.id,'Facts — aumento de gastos em '+label,
     ['Alerta estatístico dos gastos confirmados do Noah.',
      'Categoria: '+label,'Mês: '+String(alert.period_month).slice(0,7),
      'Mês anterior: '+format(previous),'Mês analisado: '+format(current),
      'Aumento: '+percent+'%',
      'Apenas despesas confirmadas entram neste cálculo.',
      'Abrir Facts: '+FACTS_URL+'?bank=1'].join('\n'),
   );
   const {error:markError}=await admin.from('facts_bank_insight_notifications')
    .update({status:'sent',sent_at:new Date().toISOString(),last_error_code:null,updated_at:new Date().toISOString()})
    .eq('id',alert.id);
   if(markError)throw Error('insight_mark_sent_'+markError.code);
   summary.insightsSent++;
  }catch(error){
   const reason=error instanceof Error?error.message:'insight_email_failed';
   const {error:markError}=await admin.from('facts_bank_insight_notifications')
    .update({status:'failed',last_error_code:reason.slice(0,100),updated_at:new Date().toISOString()})
    .eq('id',alert.id);
   if(markError)console.error('bank-sync insight_state_failure',markError.code);
   summary.insightsFailed++;
  }
 }
}

Deno.serve(async(request)=>{
  if(request.method==='GET'&&new URL(request.url).pathname.endsWith('/health'))
    return response({status:'ok',service:'bank-sync'});
  if(request.method!=='POST')return response({error:'method_not_allowed'},405);
  const url=Deno.env.get('SUPABASE_URL')??'';
  const role=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')??'';
  if(!url||!role)return response({error:'bank_configuration'},500);
  const admin=createClient(url,role,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data:rawConfig,error:configError}=await admin.rpc('facts_pluggy_runtime_config');
  if(configError)return response({error:'bank_configuration',code:configError.code},500);
  const configResult=configSchema.safeParse(rawConfig);
  if(!configResult.success)return response({error:'bank_configuration'},500);
  const config=configResult.data;
  const cron=request.headers.get('x-facts-sync-secret')??'';
  const isCron=safeEqual(cron,config.cronSecret);
  if(!isCron)return response({error:'unauthorized'},401);
  if(!config.clientId||!config.clientSecret)return response({error:'pluggy_not_configured'},503);
  const pluggy=new FactsPluggyClient(config.clientId,config.clientSecret);
  const mail:MailConfiguration|null=config.emailKey&&config.emailTo&&config.emailFrom
    ?{key:config.emailKey,recipient:config.emailTo,sender:config.emailFrom}:null;
  const summary:Summary={seen:0,ledger:0,imported:0,linkedExisting:0,replayed:0,
    needsReview:0,newReviews:0,notificationsSent:0,notificationsFailed:0,insightsQueued:0,insightsSent:0,insightsFailed:0,skipped:0};
  const today=businessDate();
  try{
    for(const settings of config.settings){
      const rules=config.rules.filter((rule)=>rule.ownerId===settings.ownerId) as RecipientRule[];
      const learning=config.learningRules.filter((rule)=>rule.ownerId===settings.ownerId);
      const {data:facts,error:factsError}=await admin.from('facts')
        .select('id,occurred_at,amount_cents')
        .eq('owner_id',settings.ownerId).eq('dependent_id',settings.dependentId)
        .eq('kind','transfer').eq('transfer_purpose','pensao')
        .gte('occurred_at',settings.ledgerFrom).lte('occurred_at',today)
        .order('occurred_at',{ascending:true}).limit(5000);
      if(factsError)throw Error('pension_facts_'+factsError.code);
      const knownPensions=(facts??[]) as {id:string;occurred_at:string;amount_cents:number}[];
      const pensionMonths=new Set(knownPensions.map((row)=>monthStart(row.occurred_at)));
      const linkedIds=new Set<string>();
      const {data:linked,error:linkedError}=await admin.from('facts_bank_transactions')
        .select('fact_id,competence_month').eq('owner_id',settings.ownerId)
        .eq('classification','pensao').not('fact_id','is',null).limit(5000);
      if(linkedError)throw Error('linked_facts_'+linkedError.code);
      for(const row of (linked??[])){
        if(row.fact_id)linkedIds.add(row.fact_id);
        if(row.competence_month)pensionMonths.add(row.competence_month);
      }

      const connections=config.connections.filter(connection=>connection.ownerId===settings.ownerId);
      if(!connections.length)throw Error('pluggy_connections_missing');
      for(const connection of connections){
        const from=connection.lastSyncedAt
          ?overlapStart(settings.ledgerFrom,connection.lastSyncedAt.slice(0,10))
          :settings.ledgerFrom;
        const details=await pluggy.item(connection.itemId);
        const institution=connection.institution||
          (details.connector&&typeof details.connector==='object'&&
           typeof (details.connector as Record<string,unknown>).name==='string'
            ?(details.connector as {name:string}).name:null);
        const accounts=await pluggy.accounts(connection.itemId);
        for(const account of accounts){
          let batch:BankFeedTransaction[]=[];
          const flush=async()=>{
            if(!batch.length)return;
            summary.seen+=batch.length;
            const stored=await storePage(admin,settings.ownerId,batch);
            await processEntries(admin,settings,rules,learning,batch,stored,summary,today,
              pensionMonths,knownPensions,linkedIds);
            batch=[];
          };
          for await(const raw of pluggy.transactions(account.id,from)){
            batch.push(mapPluggyTransaction(
              raw as Parameters<typeof mapPluggyTransaction>[0],
              connection.itemId,account.id,institution,
            ));
            if(batch.length>=150)await flush();
          }
          await flush();
        }
        const {error:connError}=await admin.from('facts_pluggy_connections').update({
          last_synced_at:new Date().toISOString(),
          last_error_code:null,updated_at:new Date().toISOString(),
        }).eq('owner_id',settings.ownerId).eq('item_id',connection.itemId);
        if(connError)throw Error('connection_checkpoint_'+connError.code);
      }
      const {error:updateError}=await admin.from('facts_bank_settings')
        .update({last_synced_at:new Date().toISOString(),updated_at:new Date().toISOString()})
        .eq('owner_id',settings.ownerId);
      if(updateError)throw Error('sync_cursor_update_'+updateError.code);
      const lastMonth=new Date(today.slice(0,7)+'-01T12:00:00.000Z');
      lastMonth.setUTCMonth(lastMonth.getUTCMonth()-1);
      const {data:queued,error:insightError}=await admin.rpc('facts_queue_monthly_insights',{
       p_owner:settings.ownerId,p_month:lastMonth.toISOString().slice(0,10),
      });
      if(insightError)throw Error('insights_queue_'+insightError.code);
      summary.insightsQueued+=Number(queued??0);
    }
    await flushNotifications(admin,mail,summary);
    await flushMonthlyInsights(admin,mail,summary);
    return response({ok:summary.notificationsFailed===0&&summary.insightsFailed===0,
      mailConfigured:mail!==null,...summary});
  }catch(error){
    console.error('bank-sync',error instanceof Error?error.message:'unknown');
    return response({error:'bank_sync_failed',summary},502);
  }
});
