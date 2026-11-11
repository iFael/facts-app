import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {readFile,mkdir,writeFile,rename,unlink} from 'node:fs/promises';
import {homedir} from 'node:os';
import {join,resolve} from 'node:path';
import {createInterface,emitKeypressEvents} from 'node:readline';
import {createClient} from '@supabase/supabase-js';
import {createWindowsCredentialEncryption} from './dpapi.mjs';
import {collectFactsReadContext} from './read-only.mjs';
import {parseChatRequest,summarizeBankRows} from '../../src/agent/local-contract.ts';

const storageDir=join(homedir(),'.config','facts-financial-agent');
const tokenFile=join(storageDir,'facts-bridge-session.dpapi');
const localCli=resolve(import.meta.dirname,'index.mjs');
const command=process.argv[2]??'help';

function config(){
 const raw=process.env.FACTS_BRIDGE_ENV||'';
 const file=raw||resolve(import.meta.dirname,'../../.env.local');
 return readFile(file,'utf8').then(text=>{
  function get(key){
   const match=text.match(new RegExp('^'+key+'=(.*)$','m'));
   if(!match)throw Error('Configuração Facts indisponível.');
   const value=match[1].trim().replace(/^["']|["']$/g,'');
   if(!value)throw Error('Configuração Facts indisponível.');
   return value;
  }
  const url=get('NEXT_PUBLIC_SUPABASE_URL'),key=get('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY');
  if(new URL(url).hostname!=='gpbsjmagjxpnoooldgtk.supabase.co')
   throw Error('URL Supabase inesperada.');
  return {url,key};
 });
}

async function authClient(){
 if(process.platform!=='win32')throw Error('A ponte exige Windows DPAPI.');
 const {url,key}=await config();
 const crypto=createWindowsCredentialEncryption();
 const storage={
  async getItem(name){
   if(name!=='facts-bridge-auth')return null;
   let data;
   try{data=await readFile(tokenFile,'utf8');}catch(err){
    if(err.code==='ENOENT')return null;
    throw err;
   }
   const decrypted=await crypto.decrypt(Buffer.from(data,'base64'));
   return decrypted;
  },
  async setItem(name,value){
   if(name!=='facts-bridge-auth')return;
   await mkdir(storageDir,{recursive:true});
   const encrypted=await crypto.encrypt(value);
   const temporary=tokenFile+'.'+randomUUID()+'.tmp';
   await writeFile(temporary,Buffer.from(encrypted).toString('base64'),'utf8');
   try{await rename(temporary,tokenFile);}finally{
    await unlink(temporary).catch(()=>{});
   }
  },
  async removeItem(name){
   if(name!=='facts-bridge-auth')return;
   await unlink(tokenFile).catch(err=>{if(err.code!=='ENOENT')throw err;});
  }
 };
 return createClient(url,key,{
  auth:{storageKey:'facts-bridge-auth',storage,persistSession:true,
   autoRefreshToken:true,detectSessionInUrl:false},
 });
}

function safeBridgeError(error){
 const code=error&&typeof error==='object'&&typeof error.code==='string'?error.code:'';
 if(code==='invalid_credentials')return 'E-mail ou senha do Facts incorretos. Confira o login utilizado no site.';
 if(code==='email_not_confirmed')return 'E-mail do Facts ainda não confirmado. Confirme antes de entrar.';
 if(code==='over_request_rate_limit'||code==='over_email_send_rate_limit')
  return 'Muitas tentativas de autenticação. Aguarde antes de tentar novamente.';
 if(error?.name==='AuthRetryableFetchError'||code==='fetch_error')
  return 'Não foi possível conectar ao serviço de autenticação do Supabase.';
 if(code&&/^[a-z_]{1,50}$/.test(code))
  return 'Supabase recusou o login (código: '+code+').';
 const message=error instanceof Error?error.message:'';
 const known=new Set([
  'A ponte exige Windows DPAPI.',
  'Configuração Facts indisponível.',
  'URL Supabase inesperada.',
  'Informe um e-mail válido da conta Facts.',
  'A senha do Facts não pode ficar vazia.',
  'A sessão da ponte não foi salva pelo Windows.',
  'Sessão Facts ausente. Execute bridge.mjs login.',
  'Execute o login diretamente no PowerShell.',
  'Informe a senha diretamente em um PowerShell interativo.',
  'Windows DPAPI operation failed.',
  'Invalid Windows DPAPI output.',
  'Login cancelado.',
  'Falha na autenticação Facts.',
 ]);
 if(known.has(message))return message;
 if(code==='ENOENT')return 'Arquivo de configuração ou sessão local não encontrado.';
 return 'Falha inesperada na autenticação. Nenhuma credencial foi exibida.';
}

async function askEmail(){
 const rl=createInterface({input:process.stdin,output:process.stdout});
 try{return (await new Promise(resolve=>rl.question('E-mail do Facts: ',resolve))).trim();}
 finally{rl.close();}
}

async function askSecret(){
 if(!process.stdin.isTTY||!process.stdin.setRawMode)
  throw Error('Informe a senha diretamente em um PowerShell interativo.');
 process.stdout.write('Senha do Facts (entrada oculta): ');
 emitKeypressEvents(process.stdin);
 process.stdin.setRawMode(true);
 process.stdin.resume();
 return new Promise((resolve,reject)=>{
  let password='';
  function restore(){
   process.stdin.off('keypress',onKey);
   process.stdin.setRawMode(false);
   process.stdin.pause();
   process.stdout.write('\n');
  }
  function onKey(char,key={}){
   if(key.ctrl&&key.name==='c'){
    restore();reject(Error('Login cancelado.'));return;
   }
   if(key.name==='return'||key.name==='enter'){
    restore();resolve(password);return;
   }
   if(key.name==='backspace'){password=password.slice(0,-1);return;}
   if(char&&!key.ctrl&&!key.meta)password+=char;
  }
  process.stdin.on('keypress',onKey);
 });
}

async function siwc(args,stdin){
 return new Promise((resolveTask,rejectTask)=>{
  const child=spawn(process.execPath,[localCli,...args],{
   cwd:resolve(import.meta.dirname,'../..'),
   stdio:['pipe','pipe','pipe'],windowsHide:true,
  });
  let stdout='',stderr='',settled=false;
  const timeout=setTimeout(()=>{child.kill();fail();},75_000);
  function fail(){
   if(settled)return;
   settled=true;clearTimeout(timeout);
   rejectTask(Error('O ChatGPT local não respondeu.'));
  }
  child.on('error',fail);
  child.stdout.on('data',data=>{
   stdout+=String(data);
   if(stdout.length>18_000){child.kill();fail();}
  });
  child.stderr.on('data',data=>{
   stderr+=String(data);
   if(stderr.length>5_000){child.kill();fail();}
  });
  child.on('close',code=>{
   if(settled)return;
   if(code!==0)return fail();
   try{
    const parsed=JSON.parse(stdout);
    settled=true;clearTimeout(timeout);
    resolveTask(parsed);
   }catch{fail();}
  });
  child.stdin.on('error',fail);
  child.stdin.end(stdin??'');
 });
}

async function validatedUser(client){
 const {data,error}=await client.auth.getUser();
 if(error||!data.user)throw Error('Sessão Facts ausente. Execute bridge.mjs login.');
 return data.user.id;
}

async function bankContext(client,userId){
 const to=new Intl.DateTimeFormat('sv-SE',{
  timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit',
 }).format(new Date());
 const from=new Date(Date.now()-45*86_400_000).toISOString().slice(0,10);
 const {data,count,error}=await client.from('facts_bank_transactions')
  .select('occurred_at,amount_cents,direction,institution,category',{count:'exact'})
  .eq('owner_id',userId).eq('tx_status','POSTED')
  .eq('foreign_charge',false)
  .gte('occurred_at',from).lte('occurred_at',to)
  .order('occurred_at',{ascending:false}).limit(300);
 if(error||count===null)throw Error('Não foi possível consultar o extrato.');
 return summarizeBankRows(data??[],count,from,to);
}

async function run(client,userId){
 const readConfig=await config();
 const siwcStatus=await siwc(['status']);
 if(siwcStatus.status!=='connected'||siwcStatus.planUsageAuthorized!==true)
  throw Error('Conecte a conta ChatGPT pelo comando index.mjs login.');
 let running=true,heartBusy=false;
 process.on('SIGINT',()=>{running=false;});
 process.on('SIGTERM',()=>{running=false;});
 async function heartbeat(initial=false){
  if(heartBusy||!running)return;
  heartBusy=true;
  try{
   const {error}=await client.rpc('facts_agent_heartbeat');
   if(error)throw error;
  }catch{
   if(initial)throw Error('A presença do agente não está disponível no Supabase.');
   process.stderr.write('Não foi possível confirmar presença do agente.\n');
  }finally{heartBusy=false;}
 }
 await heartbeat(true);
 const timer=setInterval(()=>void heartbeat(),12_000);
 process.stdout.write('Agente Facts conectado. Ctrl+C encerra a ponte.\n');
 try{
  while(running){
   try{
    const {data,error}=await client.from('facts_agent_jobs')
     .select('id,question,history').eq('owner_id',userId).eq('status','queued')
     .gt('expires_at',new Date().toISOString()).order('created_at').limit(1);
    if(error)throw error;
    for(const job of data??[]){
     if(!running)break;
     const {data:claimed,error:claimError}=await client.from('facts_agent_jobs')
      .update({status:'working'}).eq('id',job.id).eq('owner_id',userId)
      .eq('status','queued').select('id').maybeSingle();
     if(claimError)throw claimError;
     if(!claimed)continue;
     try{
      const request=parseChatRequest({question:job.question,history:job.history});
      const context=await bankContext(client,userId);
      const factsReadOnlyContext=await collectFactsReadContext({
       question:request.question,client,ownerId:userId,bankSummary:context,...readConfig,
      });
      const result=await siwc(['chat'],JSON.stringify({
       ...request,financialContext:context,factsReadOnlyContext,
      }));
      if(typeof result.reply!=='string'||!result.reply.trim()||result.reply.length>8000)
       throw Error('Resposta inválida do ChatGPT.');
      const {error:replyError}=await client.from('facts_agent_jobs')
       .update({status:'done',reply:result.reply,coverage:context.complete?'complete':'partial'})
       .eq('id',job.id).eq('owner_id',userId).eq('status','working');
      if(replyError)throw replyError;
     }catch{
      await client.from('facts_agent_jobs').update({
       status:'error',error_code:'agent_unavailable',
      }).eq('id',job.id).eq('owner_id',userId).eq('status','working');
      process.stderr.write('Solicitação não concluída; detalhes financeiros omitidos.\n');
     }
    }
   }catch{
    process.stderr.write('Conexão Facts indisponível; tentando novamente.\n');
   }
   if(running)await new Promise(resolve=>setTimeout(resolve,2000));
  }
 }finally{clearInterval(timer);}
}

async function main(){
 if(command==='help'){
  process.stdout.write([
   'Ponte local Facts: utiliza sua conta ChatGPT Plus pelo SIWC no Windows.',
   '  node tools/siwc-poc/bridge.mjs login   Autenticar no Facts (senha oculta).',
   '  node tools/siwc-poc/bridge.mjs status  Verificar sessão Facts.',
   '  node tools/siwc-poc/bridge.mjs run     Conectar o PC ao chat do site.',
   '  node tools/siwc-poc/bridge.mjs logout Encerrar somente esta sessão Facts.',
  ].join('\n')+'\n');
  return;
 }
 if(!['login','status','run','logout'].includes(command))
  throw Error('Comando não reconhecido.');
 const client=await authClient();
 try{
  if(command==='login'){
   if(!process.stdin.isTTY)throw Error('Execute o login diretamente no PowerShell.');
   const email=await askEmail();
   if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    throw Error('Informe um e-mail válido da conta Facts.');
   const password=await askSecret();
   if(!password)throw Error('A senha do Facts não pode ficar vazia.');
   const {data,error}=await client.auth.signInWithPassword({email,password});
   if(error)throw error;
   if(!data.user)throw Error('Falha na autenticação Facts.');
   try{
    const persisted=await readFile(tokenFile,'utf8');
    if(!persisted.trim())throw Error('Sessão não armazenada.');
   }catch{
    throw Error('A sessão da ponte não foi salva pelo Windows.');
   }
   process.stdout.write('Sessão local do Facts protegida por Windows DPAPI.\n');
  }else if(command==='logout'){
   await client.auth.signOut({scope:'local'});
   process.stdout.write('Sessão local encerrada.\n');
  }else if(command==='status'){
   await validatedUser(client);
   process.stdout.write('Sessão do Facts conectada e armazenada localmente.\n');
  }else{
   const userId=await validatedUser(client);
   await run(client,userId);
  }
 }finally{
  await client.auth.stopAutoRefresh();
 }
}
main().catch(error=>{
 process.stderr.write('Ponte Facts: '+safeBridgeError(error)+'\n');
 process.exitCode=1;
});
