import {createClient} from 'npm:@supabase/supabase-js@2.116.0';
import {registrationStatus} from '../_shared/registration-status.ts';

const cors={
 'Access-Control-Allow-Origin':'*',
 'Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type',
 'Access-Control-Allow-Methods':'POST, OPTIONS'
};
const limits=new Map<string,{count:number;resetAt:number}>();
const WINDOW_MS=60_000,MAX_REQUESTS=10;

function json(body:unknown,status=200){return new Response(JSON.stringify(body),{status,headers:{...cors,'Content-Type':'application/json'}});}
function allowed(ip:string){
 const now=Date.now(),current=limits.get(ip);
 if(!current||current.resetAt<=now){limits.set(ip,{count:1,resetAt:now+WINDOW_MS});return true;}
 if(current.count>=MAX_REQUESTS)return false;
 current.count++;return true;
}

Deno.serve(async request=>{
 if(request.method==='OPTIONS')return new Response('ok',{headers:cors});
 if(request.method!=='POST')return json({error:'method_not_allowed'},405);
 const ip=request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()||'unknown';
 if(!allowed(ip))return json({error:'rate_limited'},429);
 try{
  const payload=await request.json();
  const email=typeof payload?.email==='string'?payload.email.trim().toLowerCase():'';
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))return json({error:'invalid_email'},400);
  const url=Deno.env.get('SUPABASE_URL'),serviceRole=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if(!url||!serviceRole)return json({error:'server_configuration'},500);
  const admin=createClient(url,serviceRole,{auth:{persistSession:false,autoRefreshToken:false}});
  let page=1,found:undefined|{email_confirmed_at?:string|null};
  while(page){
   const {data,error}=await admin.auth.admin.listUsers({page,perPage:1000});
   if(error)return json({error:'lookup_failed'},500);
   const user=data.users.find(item=>item.email?.toLowerCase()===email);
   if(user){found=user;break;}
   page=data.nextPage??0;
  }
  return json({status:registrationStatus(found)});
 }catch{return json({error:'invalid_request'},400);}
});
