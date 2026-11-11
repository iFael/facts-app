'use client';

import {useEffect,useId,useRef,useState,type FormEvent} from 'react';
import {Bot,Send,Trash2,X} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Textarea} from '@/components/ui/textarea';
import {supabase} from '@/lib/supabase/client';
import {agentHeartbeatFresh,agentJobResult} from '@/agent/remote-contract';

type Turn={role:'user'|'assistant';content:string};

async function remoteChat(userId:string,question:string,history:Turn[]):Promise<{reply:string;coverage:'complete'|'partial'|null}>{
 const {data:presence,error:presenceError}=await supabase.from('facts_agent_presence')
  .select('last_seen_at').eq('owner_id',userId).maybeSingle();
 if(presenceError||!agentHeartbeatFresh(presence?.last_seen_at))
  throw new Error('O agente está offline. Ligue o computador e inicie a ponte Facts.');
 const {data:job,error:insertError}=await supabase.from('facts_agent_jobs')
  .insert({owner_id:userId,question,history})
  .select('id').single();
 if(insertError||typeof job?.id!=='string')
  throw new Error('Não foi possível enviar a pergunta ao agente.');
 try{
  for(let attempt=0;attempt<90;attempt++){
   await new Promise(resolve=>setTimeout(resolve,1500));
   const {data,error}=await supabase.from('facts_agent_jobs')
    .select('status,reply,coverage').eq('owner_id',userId).eq('id',job.id).maybeSingle();
   if(error||!data)throw new Error('A conexão com o agente foi interrompida.');
   const result=agentJobResult(data);
   if(!result)throw new Error('Resposta inválida do agente.');
   if(result.status==='done')return {reply:result.reply!,coverage:result.coverage};
   if(result.status==='error')throw new Error('O agente não conseguiu responder. Confira a sessão do ChatGPT no computador.');
  }
  throw new Error('O agente demorou para responder. Confira a conexão no computador.');
 }finally{
  // Best effort: the database also expires and purges transient jobs.
  void supabase.from('facts_agent_jobs').delete().eq('owner_id',userId).eq('id',job.id).then(()=>{});
 }
}

export function LocalFinancialAgent({userId,remote=false}:{userId:string;remote?:boolean}){
 const [open,setOpen]=useState(false);
 const [messages,setMessages]=useState<Turn[]>([]);
 const [question,setQuestion]=useState('');
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState('');
 const [coverage,setCoverage]=useState<'complete'|'partial'|null>(null);
 const [agentOnline,setAgentOnline]=useState(!remote);
 const requestInFlight=useRef(false);
 const launcherRef=useRef<HTMLButtonElement>(null);
 const questionRef=useRef<HTMLTextAreaElement>(null);
 const logRef=useRef<HTMLDivElement>(null);
 const panelId=useId();
 const titleId=useId();

 useEffect(()=>{
  if(!remote)return;
  let active=true;
  async function check(){
   const {data,error}=await supabase.from('facts_agent_presence')
    .select('last_seen_at').eq('owner_id',userId).maybeSingle();
   if(active)setAgentOnline(!error&&agentHeartbeatFresh(data?.last_seen_at));
  }
  void check();
  const interval=setInterval(()=>void check(),12000);
  return()=>{active=false;clearInterval(interval);};
 },[remote,userId]);

 useEffect(()=>{
  if(!open)return;
  questionRef.current?.focus();
  const handleKey=(event:KeyboardEvent)=>{
   if(event.key==='Escape'){
    setOpen(false);
    launcherRef.current?.focus();
   }
  };
  document.addEventListener('keydown',handleKey);
  return ()=>document.removeEventListener('keydown',handleKey);
 },[open]);

 useEffect(()=>{
  if(open&&logRef.current)logRef.current.scrollTop=logRef.current.scrollHeight;
 },[open,messages,busy]);

 async function ask(event:FormEvent<HTMLFormElement>){
  event.preventDefault();
  if(requestInFlight.current)return;
  const message=question.trim();
  if(!agentOnline||!message||message.length>1000)return;
  requestInFlight.current=true;
  setBusy(true);
  setError('');
  const history=messages.slice(-6).map(turn=>({
   role:turn.role,content:turn.content.slice(0,1600),
  }));
  setQuestion('');
  setMessages(previous=>[...previous,{role:'user',content:message}]);
  try{
   let result:{reply:string;coverage?:'complete'|'partial'|null};
   if(remote){
    result=await remoteChat(userId,message,history);
   }else{
    const response=await fetch('/api/local-agent',{
     method:'POST',credentials:'same-origin',
     headers:{'Content-Type':'application/json'},cache:'no-store',
     body:JSON.stringify({question:message,history}),
    });
    const body=await response.json() as {reply?:string;coverage?:'complete'|'partial';error?:string};
    if(!response.ok||typeof body.reply!=='string'||!body.reply.trim())
     throw new Error(body.error||'Não foi possível obter uma resposta.');
    result={reply:body.reply,coverage:body.coverage};
   }
   setMessages(previous=>[...previous,{role:'assistant',content:result.reply!}]);
   setCoverage(result.coverage??null);
  }catch(err){
   setError(err instanceof Error?err.message:'Não foi possível consultar o agente local.');
  }finally{
   requestInFlight.current=false;
   setBusy(false);
  }
 }

 return <>
  {open&&<section
   id={panelId} role="dialog" aria-modal={false} aria-labelledby={titleId}
   className="fixed inset-x-3 bottom-[calc(10rem+env(safe-area-inset-bottom))] z-50 flex h-[min(31rem,calc(100dvh-12rem))] min-h-0 flex-col overflow-hidden rounded-2xl border border-border bg-card text-card-foreground shadow-2xl sm:inset-x-auto sm:right-6 sm:bottom-24 sm:h-[min(36rem,calc(100dvh-8rem))] sm:w-[410px]">
   <header className="flex shrink-0 items-center gap-3 border-b border-border px-4 py-3">
    <span className="grid size-10 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground">
     <Bot className="size-5" aria-hidden="true"/>
    </span>
    <div className="min-w-0 flex-1">
     <h2 id={titleId} className="text-sm font-semibold">Agente Facts</h2>
     <p className="text-xs text-muted-foreground">{remote?(agentOnline?'ChatGPT • computador online':'ChatGPT • computador offline'):'ChatGPT • ambiente local'}</p>
    </div>
    <Button type="button" variant="ghost" size="icon" aria-label="Fechar conversa"
     className="size-10 shrink-0" onClick={()=>{setOpen(false);launcherRef.current?.focus();}}>
     <X className="size-5" aria-hidden="true"/>
    </Button>
   </header>

   <div className="shrink-0 border-b border-border bg-muted/30 px-4 py-2 text-xs leading-relaxed text-muted-foreground">
    Movimentações agregadas dos últimos 45 dias. Sem saldo verificado nem previsão nesta versão.
    Conversa mantida nesta aba. Pedidos remotos expiram e são eliminados do servidor.
    {coverage==='partial'&&<p className="font-medium text-amber-700 dark:text-amber-300">
     Consulta parcial: os totais não incluem todas as movimentações.
    </p>}
   </div>

   <div ref={logRef} role="log" aria-label="Mensagens do agente" aria-live="polite"
    className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-4 sm:px-4">
    {remote&&!agentOnline&&<p role="status" className="rounded-xl bg-muted p-3 text-sm text-muted-foreground">O computador está desligado ou a ponte Facts não foi iniciada. O restante do aplicativo continua disponível.</p>}
    {messages.length===0&&<p className="text-sm leading-relaxed text-muted-foreground">
     Olá! Pergunte sobre seus gastos recentes ou o que falta para prever seu saldo.
    </p>}
    {messages.map((turn,index)=><div key={index}
     className={'max-w-[93%] break-words whitespace-pre-wrap rounded-2xl px-3 py-2.5 text-sm leading-relaxed '+
      (turn.role==='user'?'ml-auto rounded-br-sm bg-primary text-primary-foreground'
      :'mr-auto rounded-bl-sm bg-muted text-foreground')}>
     <p className="mb-1 text-xs font-medium opacity-70">
      {turn.role==='user'?'Você':'Agente Facts'}
     </p>
     {turn.content}
    </div>)}
    {busy&&<p role="status" className="text-sm text-muted-foreground">Analisando os dados...</p>}
   </div>

   <div className="shrink-0 border-t border-border bg-card px-3 py-3">
    {error&&<p role="alert" className="mb-2 rounded-lg bg-destructive/10 p-2 text-xs text-destructive">{error}</p>}
    <form className="space-y-2" onSubmit={e=>void ask(e)}>
     <label htmlFor="agent-question" className="sr-only">Mensagem para o agente</label>
     <Textarea ref={questionRef} id="agent-question" rows={2} maxLength={1000} value={question}
      disabled={busy||!agentOnline} className="max-h-28 resize-none"
      placeholder="Converse com seu agente financeiro..."
      onChange={event=>setQuestion(event.target.value)}/>
     <div className="flex items-center justify-between gap-2">
      <Button type="button" variant="ghost" size="sm" disabled={busy||messages.length===0}
       onClick={()=>{setMessages([]);setCoverage(null);setError('');}}>
       <Trash2 className="size-4" aria-hidden="true"/> Limpar
      </Button>
      <Button type="submit" size="sm" disabled={busy||!agentOnline||!question.trim()} className="gap-2">
       <Send className="size-4" aria-hidden="true"/> Enviar
      </Button>
     </div>
    </form>
   </div>
  </section>}

  <button ref={launcherRef} type="button" aria-label={open?'Fechar agente financeiro':'Conversar com agente financeiro'}
   aria-expanded={open} aria-controls={panelId} title={open?'Fechar conversa':'Conversar com o agente'}
   onClick={()=>setOpen(value=>!value)}
   className="fixed right-4 bottom-[calc(5.5rem+env(safe-area-inset-bottom))] z-50 grid size-14 place-items-center rounded-full bg-primary text-primary-foreground shadow-lg ring-4 ring-background transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring sm:right-6 sm:bottom-6">
   {open?<X className="size-6" aria-hidden="true"/>:<Bot className="size-7" aria-hidden="true"/>}
   {remote&&<span aria-hidden="true" className={'absolute right-0 top-0 size-3 rounded-full border-2 border-background '+(agentOnline?'bg-emerald-500':'bg-slate-400')}/>}
  </button>
 </>;
}
