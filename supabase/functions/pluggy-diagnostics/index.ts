import {createClient} from 'npm:@supabase/supabase-js@2.116.0';

type RecordLike=Record<string,unknown>;
function object(value:unknown):RecordLike|null{
  return value!==null&&typeof value==='object'&&!Array.isArray(value)
    ? value as RecordLike:null;
}
function safeEquals(a:string,b:string):boolean{
  if(!a||a.length!==b.length)return false;
  let mismatch=0;
  for(let i=0;i<a.length;i++)mismatch|=a.charCodeAt(i)^b.charCodeAt(i);
  return mismatch===0;
}
function result(body:unknown,status=200):Response{
  return new Response(JSON.stringify(body),{
    status,headers:{'content-type':'application/json','cache-control':'no-store'},
  });
}
async function callApi(url:string,init?:RequestInit):Promise<{
  status:number;body:RecordLike|null
}>{
  const res=await fetch(url,{
    ...init,signal:AbortSignal.timeout(15000),
  });
  let body:RecordLike|null=null;
  try{body=object(await res.json());}catch{/** response may not be JSON */}
  return{status:res.status,body};
}
const API='https://api.pluggy.ai';

Deno.serve(async request=>{
  if(request.method!=='POST')return result({error:'method_not_allowed'},405);
  const url=Deno.env.get('SUPABASE_URL');
  const key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if(!url||!key)return result({error:'environment_unavailable'},503);
  const db=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data,error}=await db.rpc('facts_pluggy_runtime_config');
  if(error||!object(data))return result({error:'configuration_unavailable'},503);
  const configuration=data as RecordLike;
  const cron=typeof configuration.cronSecret==='string'?configuration.cronSecret:'';
  if(!safeEquals(request.headers.get('x-facts-sync-secret')??'',cron))
    return result({error:'unauthorized'},401);

  const clientId=typeof configuration.clientId==='string'?configuration.clientId:'';
  const clientSecret=typeof configuration.clientSecret==='string'?configuration.clientSecret:'';
  const connections=Array.isArray(configuration.connections)?configuration.connections:[];
  if(!clientId||!clientSecret){
    return result({
      configured:false,auth:'not_tested',listItems:'not_tested',
      registeredConnections:connections.length,
      reason:'facts_pluggy_credentials_missing',
    });
  }

  try{
    const auth=await callApi(API+'/auth',{
      method:'POST',headers:{'content-type':'application/json'},
      body:JSON.stringify({clientId,clientSecret}),
    });
    const token=auth.body&&typeof auth.body.apiKey==='string'?auth.body.apiKey:null;
    if(auth.status!==200||!token)
      return result({configured:true,auth:{status:auth.status,valid:false},
        listItems:'not_tested',registeredConnections:connections.length});

    const headers={'x-api-key':token};
    const list=await callApi(API+'/v2/items',{headers});
    const listResult={
      status:list.status,
      allowed:list.status===200,
      featureDisabled:list.status===403
        && list.body?.code==='LIST_ITEMS_FEATURE_NOT_ENABLED',
      returnedItems:Array.isArray(list.body?.results)?list.body.results.length:null,
    };

    const probes:Array<RecordLike>=[];
    for(const entry of connections.slice(0,5)){
      const item=object(entry);
      if(!item||typeof item.itemId!=='string'||!/^[0-9a-f-]{36}$/i.test(item.itemId))
        continue;
      const itemId=item.itemId;
      const info=await callApi(API+'/items/'+encodeURIComponent(itemId),{headers});
      const accounts=await callApi(API+'/accounts?itemId='+encodeURIComponent(itemId),{headers});
      const accountList=Array.isArray(accounts.body?.results)?accounts.body.results:[];
      const firstAccount=accountList.map(object).find(a=>a&&typeof a.id==='string');
      let transactions:{status:number;count:number|null;cursorShape:string|null}|null=null;
      if(firstAccount&&typeof firstAccount.id==='string'){
        const qs=new URLSearchParams({
          accountId:firstAccount.id,dateFrom:'2026-10-01',
        });
        const tx=await callApi(API+'/v2/transactions?'+qs.toString(),{headers});
        transactions={
          status:tx.status,
          count:Array.isArray(tx.body?.results)?tx.body.results.length:null,
          cursorShape:typeof tx.body?.next,
        };
      }
      probes.push({
        registered:true,
        itemStatus:info.status,
        accountsStatus:accounts.status,
        accountsCount:accountList.length,
        transactions,
      });
    }
    return result({
      configured:true,auth:{status:200,valid:true},
      listItems:listResult,registeredConnections:connections.length,
      connectionReadResults:probes,
    });
  }catch(error){
    const code=error instanceof Error && error.name==='TimeoutError'
      ? 'pluggy_timeout':'pluggy_network_error';
    return result({configured:true,error:code},502);
  }
});
