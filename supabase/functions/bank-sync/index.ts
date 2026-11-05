import {createClient} from 'npm:@supabase/supabase-js@2.116.0';
import {z} from 'npm:zod@4.6.4';
import {
 classifyTransfer,matchRecipient,moneyToCents,overlapStart,signedMoneyToCents,
 type BankFeedTransaction,type RecipientRule
} from '../../../src/bank/automation.ts';

const FEED_URL='https://ciclo-peach.vercel.app/api/integrations/facts';
const headers={'Content-Type':'application/json','Cache-Control':'no-store'};

const ruleSchema=z.object({
 ownerId:z.string().uuid(),
 dependentId:z.string().uuid(),
 canonicalName:z.string().min(1).max(160),
 normalizedName:z.string().min(1).max(160),
 pensionAmountCents:z.number().int().positive(),
 pensionDayStart:z.number().int().min(1).max(31),
 pensionDayEnd:z.number().int().min(1).max(31),
 importFrom:z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
});
const configSchema=z.object({
 feedToken:z.string().min(16),
 cronSecret:z.string().min(16),
 rules:z.array(ruleSchema)
});
const transactionSchema=z.object({
 id:z.string().min(1).max(200),
 itemId:z.string().min(1).max(200),
 accountId:z.string().min(1).max(200),
 amount:z.number().finite(),
 originalAmount:z.number().finite().nullable(),
 chargeDate:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
 type:z.string().nullable(),
 status:z.string().nullable(),
 operationType:z.string().nullable(),
 description:z.string().max(2000),
 descriptionRaw:z.string().max(2000).nullable(),
 counterpartyName:z.string().max(200).nullable(),
 counterpartyKind:z.enum(['person','business']).nullable(),
 paymentMethod:z.string().nullable()
});
const feedSchema=z.object({ok:z.literal(true),transactions:z.array(transactionSchema).max(5000)});

function json(body:unknown,status=200){return new Response(JSON.stringify(body),{status,headers});}
function safeEqual(left:string,right:string){
 if(left.length!==right.length)return false;
 let diff=0;
 for(let index=0;index<left.length;index++)diff|=left.charCodeAt(index)^right.charCodeAt(index);
 return diff===0;
}
function dateOnly(value:unknown):string|null{
 return typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)?value:null;
}

Deno.serve(async request=>{
 if(request.method==='GET'&&new URL(request.url).pathname.endsWith('/health'))return json({status:'ok',service:'bank-sync'});
 if(request.method!=='POST')return json({error:'method_not_allowed'},405);

 const supabaseUrl=Deno.env.get('SUPABASE_URL')??'';
 const serviceRole=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')??'';
 if(!supabaseUrl||!serviceRole)return json({error:'server_configuration'},500);
 const admin=createClient(supabaseUrl,serviceRole,{auth:{persistSession:false,autoRefreshToken:false}});

 const configResult=await admin.rpc('facts_bank_runtime_config');
 if(configResult.error){
  console.error('bank-sync config',configResult.error.code);
  return json({error:'bank_configuration'},500);
 }
 const parsedConfig=configSchema.safeParse(configResult.data);
 if(!parsedConfig.success)return json({error:'bank_configuration'},500);
 const config=parsedConfig.data;

 const supplied=request.headers.get('x-facts-sync-secret')??'';
 if(!safeEqual(supplied,config.cronSecret))return json({error:'unauthorized'},401);

 const summary={rules:0,seen:0,imported:0,linkedExisting:0,replayed:0,needsReview:0};
 try{
  for(const rawRule of config.rules){
   const rule=rawRule as RecipientRule;
   summary.rules++;

   const latest=await admin
    .from('facts_bank_transactions')
    .select('occurred_at')
    .eq('owner_id',rule.ownerId)
    .eq('provider','pluggy')
    .order('occurred_at',{ascending:false})
    .limit(1)
    .maybeSingle();
   if(latest.error)throw new Error('bank_state_read_failed');
   const from=overlapStart(rule.importFrom,dateOnly(latest.data?.occurred_at));

   const url=new URL(FEED_URL);
   url.searchParams.set('from',from);
   url.searchParams.set('name',rule.canonicalName);
   const response=await fetch(url,{headers:{Authorization:`Bearer ${config.feedToken}`,Accept:'application/json'}});
   if(!response.ok)throw new Error(`feed_http_${response.status}`);
   const feed=feedSchema.parse(await response.json());

   for(const parsed of feed.transactions){
    const transaction=parsed as BankFeedTransaction;
    if(transaction.type?.toUpperCase()!=='DEBIT')continue;
    if(transaction.status&&transaction.status.toUpperCase()!=='POSTED')continue;
    const matchSource=matchRecipient(transaction,rule);
    if(!matchSource)continue;
    const amountCents=moneyToCents(transaction.amount);
    if(!amountCents)continue;
    const purpose=classifyTransfer(amountCents,transaction.chargeDate,rule);
    summary.seen++;

    const imported=await admin.rpc('facts_import_bank_transaction',{
     p_owner_id:rule.ownerId,
     p_dependent_id:rule.dependentId,
     p_provider_transaction_id:transaction.id,
     p_item_id:transaction.itemId,
     p_account_id:transaction.accountId,
     p_occurred_at:transaction.chargeDate,
     p_amount_cents:amountCents,
     p_original_amount_cents:signedMoneyToCents(transaction.originalAmount),
     p_description:transaction.descriptionRaw??transaction.description,
     p_tx_type:transaction.type,
     p_operation_type:transaction.operationType,
     p_tx_status:transaction.status,
     p_payment_method:transaction.paymentMethod,
     p_counterparty_name:transaction.counterpartyName??rule.canonicalName,
     p_match_source:matchSource,
     p_transfer_purpose:purpose,
     p_source_detail:'Pluggy — Ciclo'
    });
    if(imported.error)throw new Error(`bank_import_failed:${imported.error.code??'unknown'}`);
    const status=typeof imported.data?.status==='string'?imported.data.status:'';
    const replayed=imported.data?.replayed===true;
    if(replayed)summary.replayed++;
    else if(status==='imported')summary.imported++;
    else if(status==='linked_existing')summary.linkedExisting++;
    else if(status==='needs_review')summary.needsReview++;
    else summary.replayed++;
   }
  }
  return json({ok:true,...summary});
 }catch(error){
  console.error('bank-sync',error instanceof Error?error.message:'unknown');
  return json({error:'bank_sync_failed'},502);
 }
});
