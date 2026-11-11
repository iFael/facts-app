import {createClient} from 'npm:@supabase/supabase-js@2.116.0';
import {FactsPluggyClient} from '../_shared/pluggy.ts';

const origins=new Set([
  'https://facts-app-nu.vercel.app',
  'http://127.0.0.1:3000',
  'http://localhost:3000',
]);
function headers(request:Request):Headers{
  const result=new Headers({
    'Content-Type':'application/json',
    'Cache-Control':'no-store',
    'Vary':'Origin',
    'X-Content-Type-Options':'nosniff',
    'Access-Control-Allow-Methods':'POST, OPTIONS',
    'Access-Control-Allow-Headers':'authorization, apikey, x-client-info, content-type',
  });
  const origin=request.headers.get('origin');
  if(origin&&origins.has(origin))result.set('Access-Control-Allow-Origin',origin);
  return result;
}
function json(request:Request,body:unknown,status=200):Response{
  return new Response(JSON.stringify(body),{status,headers:headers(request)});
}
function bearer(request:Request):string|null{
  const match=/^Bearer\s+(\S+)$/i.exec(request.headers.get('authorization')??'');
  return match?.[1]??null;
}

/** Read-only Pluggy inventory for the authenticated owner; never returns credentials or PII. */
Deno.serve(async request=>{
  if(request.method==='OPTIONS'){
    if(!origins.has(request.headers.get('origin')??''))return json(request,{error:'forbidden'},403);
    return new Response(null,{status:204,headers:headers(request)});
  }
  if(request.method!=='POST')return json(request,{error:'method_not_allowed'},405);
  if(!origins.has(request.headers.get('origin')??''))return json(request,{error:'forbidden'},403);

  const jwt=bearer(request);
  const url=Deno.env.get('SUPABASE_URL');
  const serviceKey=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if(!jwt)return json(request,{error:'unauthorized'},401);
  if(!url||!serviceKey)return json(request,{error:'configuration_unavailable'},503);
  const admin=createClient(url,serviceKey,{
    auth:{persistSession:false,autoRefreshToken:false},
  });

  const {data:userResult,error:authError}=await admin.auth.getUser(jwt);
  const ownerId=userResult.user?.id;
  if(authError||!ownerId)return json(request,{error:'unauthorized'},401);

  const {data:connections,error:connectionError}=await admin.from('facts_pluggy_connections')
    .select('item_id,institution,last_synced_at')
    .eq('owner_id',ownerId).eq('status','active').limit(10);
  if(connectionError)return json(request,{error:'connection_unavailable'},503);
  if(!connections?.length)return json(request,{accounts:[],connections:0,source:'pluggy'},200);

  const {data:config,error:configError}=await admin.rpc('facts_pluggy_runtime_config');
  if(configError||typeof config?.clientId!=='string'||typeof config?.clientSecret!=='string')
    return json(request,{error:'pluggy_not_configured'},503);

  const pluggy=new FactsPluggyClient(config.clientId,config.clientSecret);
  const accounts=[];
  try{
    for(const connection of connections){
      const rows=await pluggy.inventory(connection.item_id,connection.institution??'Instituição');
      for(const row of rows){
        // Only real BANK/CREDIT accounts, with no owner identity or raw account number.
        accounts.push({
          ...row,
          lastConnectionSyncAt:connection.last_synced_at??null,
        });
      }
    }
  }catch{
    return json(request,{error:'inventory_unavailable'},503);
  }
  return json(request,{
    source:'pluggy',fetchedAt:new Date().toISOString(),
    connections:connections.length,accounts,
  });
});
