import {spawn} from 'node:child_process';
import {join} from 'node:path';
import {createServerClient} from '@supabase/ssr';
import {cookies} from 'next/headers';
import {NextResponse,type NextRequest} from 'next/server';
import {publishableKey,supabaseUrl} from '@/lib/supabase/config';
import {localRequestAllowed,parseChatRequest,summarizeBankRows,type BankRow} from '@/agent/local-contract';

export const runtime='nodejs';
export const dynamic='force-dynamic';

const noStore={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};

function reply(error:string,status:number){
 return NextResponse.json({error},{status,headers:noStore});
}

function localInference(payload:unknown):Promise<{reply:string;model:string}>{
 return new Promise((resolve,reject)=>{
  const file=join(process.cwd(),'tools','siwc-poc','index.mjs');
  const child=spawn(process.execPath,[file,'chat'],{
   cwd:process.cwd(),windowsHide:true,stdio:['pipe','pipe','pipe']
  });
  let stdout='',stderr='',done=false;
  const timeout=setTimeout(()=>child.kill(),75_000);
  const fail=(message:string)=>{
   if(done)return;
   done=true;clearTimeout(timeout);reject(new Error(message));
  };
  child.on('error',()=>fail('Falha ao iniciar o agente local.'));
  child.stdout.on('data',(chunk:Buffer)=>{
   stdout+=chunk.toString('utf8');
   if(stdout.length>16_000){child.kill();fail('Resposta excedeu o limite.');}
  });
  child.stderr.on('data',(chunk:Buffer)=>{
   stderr+=chunk.toString('utf8');
   if(stderr.length>5_000){child.kill();fail('Falha do agente local.');}
  });
  child.on('close',code=>{
   if(done)return;
   if(code!==0)return fail('O agente não conseguiu responder. Confira a conexão ChatGPT local.');
   try{
    const result=JSON.parse(stdout) as {reply?:unknown;model?:unknown};
    if(typeof result.reply!=='string'||!result.reply.trim()||
       result.reply.length>12_000||typeof result.model!=='string')
     return fail('Resposta do agente inválida.');
    done=true;clearTimeout(timeout);resolve({reply:result.reply,model:result.model});
   }catch{return fail('Resposta do agente inválida.');}
  });
  child.stdin.on('error',()=>fail('Não foi possível enviar a solicitação.'));
  child.stdin.end(JSON.stringify(payload));
 });
}

/**
 * Local development only. The hosted Facts cannot access the Windows OAuth vault.
 * No session tokens or privileged Supabase keys are sent to the model.
 */
export async function POST(request:NextRequest){
 if(!localRequestAllowed(
   request.url,request.headers.get('host'),request.headers.get('origin'),process.env.NODE_ENV
 ))return reply('Rota local indisponível.',404);
 if(!request.headers.get('content-type')?.toLowerCase().startsWith('application/json'))
  return reply('Conteúdo inválido.',415);

 let input:ReturnType<typeof parseChatRequest>;
 try{
  const body=await request.text();
  if(Buffer.byteLength(body,'utf8')>10_000)return reply('Solicitação grande demais.',413);
  input=parseChatRequest(JSON.parse(body));
 }catch{return reply('Pergunta ou histórico inválido.',400);}

 try{
  const store=await cookies();
  const supabase=createServerClient(supabaseUrl,publishableKey,{
   cookies:{
    getAll:()=>store.getAll(),
    setAll(items){for(const {name,value,options} of items)store.set(name,value,options);}
   }
  });
  const {data:auth,error:authError}=await supabase.auth.getUser();
  if(authError||!auth.user)return reply('Entre na sua conta do Facts.',401);

  const today=new Intl.DateTimeFormat('sv-SE',{
   timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit',
  }).format(new Date());
  const from=new Date(Date.now()-45*86_400_000).toISOString().slice(0,10);
  const {data,count,error}=await supabase.from('facts_bank_transactions')
   .select('occurred_at,amount_cents,direction,institution,category',{count:'exact'})
   .eq('owner_id',auth.user.id)
   .eq('tx_status','POSTED')
   .eq('foreign_charge',false)
   .gte('occurred_at',from).lte('occurred_at',today)
   .order('occurred_at',{ascending:false})
   .limit(300);
  if(error||count===null)return reply('Falha na leitura segura do extrato.',503);
  const context=summarizeBankRows(data as BankRow[],count,from,today);
  const result=await localInference({...input,financialContext:context});
  return NextResponse.json({...result,coverage:context.complete?'complete':'partial'},{
   headers:noStore,
  });
 }catch{
  return reply('O agente local não está disponível. Confira sua conexão e tente novamente.',503);
 }
}
