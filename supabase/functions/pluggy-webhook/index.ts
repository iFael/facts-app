import {createClient} from 'npm:@supabase/supabase-js@2.116.0';

const SYNC='https://gpbsjmagjxpnoooldgtk.supabase.co/functions/v1/bank-sync';
type Payload={event?:unknown;eventId?:unknown;itemId?:unknown;clientId?:unknown;transactionIds?:unknown};
function respond(status:number,body:Record<string,unknown>){
 return new Response(JSON.stringify(body),{
  status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'},
 });
}
function equals(a:string,b:string){
 if(!a||a.length!==b.length)return false;
 let diff=0;
 for(let i=0;i<a.length;i++)diff|=a.charCodeAt(i)^b.charCodeAt(i);
 return diff===0;
}
Deno.serve(async(request)=>{
 if(request.method!=='POST')return respond(405,{error:'method_not_allowed'});
 const url=Deno.env.get('SUPABASE_URL'),key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
 if(!url||!key)return respond(503,{error:'unavailable'});
 const admin=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
 const {data,error}=await admin.rpc('facts_pluggy_runtime_config');
 if(error||!data||typeof data.webhookSecret!=='string')
  return respond(503,{error:'configuration_unavailable'});
 if(!equals(request.headers.get('x-facts-webhook-secret')??'',data.webhookSecret))
  return respond(401,{error:'unauthorized'});
 const body:Payload=await request.json().catch(()=>null);
 if(!body||typeof body.event!=='string'||typeof body.itemId!=='string'
  ||!/^[a-f0-9-]{36}$/i.test(body.itemId))return respond(400,{error:'invalid_event'});
 if(typeof body.clientId==='string'&&body.clientId!==data.clientId)
  return respond(403,{error:'client_mismatch'});
 const connection=(Array.isArray(data.connections)?data.connections:[])
  .find((conn:Record<string,unknown>)=>conn.itemId===body.itemId);
 if(!connection||typeof connection.ownerId!=='string')
  return respond(202,{accepted:false,reason:'item_not_registered'});
 const itemId=body.itemId;
 if(body.event==='item/deleted'){
  const {error:removed}=await admin.from('facts_pluggy_connections').update({
   status:'removed',updated_at:new Date().toISOString(),
  }).eq('owner_id',connection.ownerId).eq('item_id',itemId);
  if(removed)return respond(503,{error:'item_update_failed'});
  return respond(200,{ok:true,status:'removed'});
 }
 const events=new Set(['item/updated','transactions/created','transactions/updated','transactions/deleted']);
 if(!events.has(body.event))return respond(200,{ok:true,ignored:true});
 if(body.event==='transactions/deleted'&&Array.isArray(body.transactionIds)){
  const ids=body.transactionIds.filter(
   (id:unknown):id is string=>typeof id==='string'&&/^[a-f0-9-]{36}$/i.test(id)
  ).slice(0,500);
  if(ids.length){
   const {error:changed}=await admin.from('facts_bank_transactions').update({
    tx_status:'DELETED',sync_state:'needs_review',updated_at:new Date().toISOString(),
   }).eq('owner_id',connection.ownerId).eq('provider','pluggy')
    .eq('item_id',itemId).in('provider_transaction_id',ids);
   if(changed)return respond(503,{error:'transaction_status_update_failed'});
  }
 }
 const pending=fetch(SYNC,{
  method:'POST',
  headers:{'Content-Type':'application/json','x-facts-sync-secret':data.cronSecret},
  body:JSON.stringify({itemId}),
  signal:AbortSignal.timeout(90000),
 }).then(async(res)=>{
  if(!res.ok)console.error('facts-webhook-sync',res.status);
 }).catch(()=>console.error('facts-webhook-sync-network-error'));
 EdgeRuntime.waitUntil(pending);
 return respond(202,{ok:true,queued:true});
});