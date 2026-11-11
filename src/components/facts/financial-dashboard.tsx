'use client';

import {useCallback,useEffect,useMemo,useState} from 'react';
import {ArrowDownLeft,ArrowUpRight,ChevronLeft,ChevronRight,CreditCard,House,RefreshCw,Target} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {MonthPicker} from '@/components/facts/month-picker';
import {supabase} from '@/lib/supabase/client';
import {money} from '@/domain/view';
import {cardAppearance,type AccountInventory} from '@/bank/account-inventory';
import {summarizeFinancialDashboard,type FinancialBankRow} from '@/bank/dashboard-data';

type Inventory={source:string;accounts:AccountInventory[]};
const surface='rounded-2xl border border-border/70 bg-card text-card-foreground shadow-[0_10px_30px_-25px_rgba(0,0,0,.45)]';
const label='text-xs text-muted-foreground';
const heading='text-sm font-semibold tracking-tight';
function Illustration({kind}:{kind:'wallet'|'calendar'|'balance'|'house'|'card'|'target'}){
 if(kind==='target')return <span aria-hidden="true" className="grid size-14 shrink-0 place-items-center rounded-2xl bg-muted text-muted-foreground"><Target className="size-8 stroke-[1.6]"/></span>;
 return <span aria-hidden="true" className="grid h-[72px] w-20 shrink-0 place-items-center overflow-hidden rounded-2xl bg-white shadow-[0_8px_24px_-15px_rgba(0,0,0,.45)] sm:h-[86px] sm:w-24">
  <img src={`/illustrations/${kind}.svg`} width="128" height="120" alt="" className="h-full w-full object-contain"/>
 </span>;
}
function CreditCardFace({account}:{account:AccountInventory}){
 const face=cardAppearance(account);
 const theme={orange:'from-orange-400 via-orange-500 to-amber-600',violet:'from-fuchsia-700 via-purple-800 to-indigo-950',navy:'from-blue-700 via-blue-800 to-slate-950',neutral:'from-slate-700 via-slate-800 to-slate-950'}[face.theme];
 return <div className={'relative flex h-44 flex-col justify-between overflow-hidden rounded-2xl bg-gradient-to-br p-4 text-white shadow-lg '+theme} aria-label={'Cartão '+face.label}>
  <div className="pointer-events-none absolute -right-14 -top-16 size-48 rounded-full border-[28px] border-white/10"/>
  <div className="relative flex justify-between gap-2">
   <div className="min-w-0"><p className="text-[11px] font-semibold opacity-80">{face.issuer}</p><p className="truncate text-sm font-semibold">{face.label}</p></div>
   <CreditCard className="size-6 shrink-0 opacity-80"/>
  </div>
  <div className="relative flex items-center justify-between">
   <span className="h-6 w-9 rounded border border-yellow-100/70 bg-gradient-to-br from-yellow-100 to-amber-500"/>
   <span className="text-xs font-semibold tracking-widest">{account.credit?.brand??''}</span>
  </div>
  <div className="relative flex justify-between text-xs">
   <span>{account.lastFour?'•••• '+account.lastFour:'Número indisponível'}</span>
   <span>{account.credit?.level??''}</span>
  </div>
 </div>;
}
function LoadingHint({children}:{children:React.ReactNode}){return <p className="rounded-xl bg-muted/40 p-3 text-xs leading-relaxed text-muted-foreground">{children}</p>;}
export function FinancialDashboard({month,onMonthChange,userId,onNavigate}:{
 month:string;onMonthChange:(value:string)=>void;userId:string;
 onNavigate?:(tab:'bank'|'statement')=>void;
}){
 const [records,setRecords]=useState<FinancialBankRow[]>([]);
 const [totalRows,setTotalRows]=useState(0);
 const [pendingCount,setPendingCount]=useState<number|null>(null);
 const [cards,setCards]=useState<AccountInventory[]|null>(null);
 const [inventoryState,setInventoryState]=useState<'loading'|'ready'|'unavailable'>('loading');
 const [loading,setLoading]=useState(true);
 const [error,setError]=useState('');
 const [refreshId,setRefreshId]=useState(0);
 const [cardIndex,setCardIndex]=useState(0);

 const load=useCallback(async()=>{
  setLoading(true);setError('');
  const next=new Date(month+'-01T00:00:00Z');
  next.setUTCMonth(next.getUTCMonth()+1);
  const limit=next.toISOString().slice(0,10);
  try{
   const [tx,pending]=await Promise.all([
    supabase.from('facts_bank_transactions')
     .select('id,occurred_at,amount_cents,direction,tx_status,institution,description,category,foreign_charge',{count:'exact'})
     .eq('owner_id',userId).eq('tx_status','POSTED')
     .gte('occurred_at',month+'-01').lt('occurred_at',limit)
     .order('occurred_at',{ascending:false}).limit(500),
    supabase.from('facts_bank_transactions').select('id',{count:'exact',head:true})
     .eq('owner_id',userId).eq('tx_status','PENDING')
     .gte('occurred_at',month+'-01').lt('occurred_at',limit),
   ]);
   if(tx.error)throw tx.error;
   setRecords((tx.data??[]) as FinancialBankRow[]);
   setTotalRows(tx.count??0);
   setPendingCount(pending.error?null:(pending.count??0));
  }catch{setError('Não foi possível carregar as movimentações deste mês.');}
  finally{setLoading(false);}
 },[month,userId]);

 useEffect(()=>{void load();},[load,refreshId]);
 useEffect(()=>{
  let active=true;
  setCards(null);
  setCardIndex(0);
  setInventoryState('loading');
  void supabase.functions.invoke('bank-accounts',{method:'POST',body:{}})
   .then(({data,error})=>{
    if(!active)return;
    const result=data as Inventory|null;
    if(error||result?.source!=='pluggy'||!Array.isArray(result.accounts)){
     setInventoryState('unavailable');return;
    }
    setCards(result.accounts.filter(account=>account.type==='CREDIT'));
    setCardIndex(0);setInventoryState('ready');
   }).catch(()=>{if(active)setInventoryState('unavailable');});
  return()=>{active=false;};
 },[refreshId]);

 const summary=useMemo(()=>summarizeFinancialDashboard(records,month),[records,month]);
 const selected=cards?.[Math.min(cardIndex,(cards?.length??1)-1)]??null;
 const homeLines=summary.housing;
 const currentMonth=new Date(month+'-01T12:00:00Z');
 const caption=new Intl.DateTimeFormat('pt-BR',{month:'long',timeZone:'UTC'}).format(currentMonth);
 const formatDate=(value:string)=>new Intl.DateTimeFormat('pt-BR',{day:'2-digit',month:'short',timeZone:'UTC'}).format(new Date(value+'T12:00:00Z'));
 const formatBillingDate=(value:string)=>new Intl.DateTimeFormat('pt-BR',{day:'2-digit',month:'2-digit',year:'numeric',timeZone:'UTC'}).format(new Date(value+'T12:00:00Z'));

 return <div className="space-y-3 pb-6">
  <header className={surface+' flex flex-wrap items-center justify-between gap-2 px-4 py-3'}>
   <div className="flex items-center gap-3">
    <MonthPicker value={month} onChange={onMonthChange} label="Mês da visão geral"/>
    <span className="hidden text-xs text-muted-foreground md:block">Seu panorama financeiro</span>
   </div>
   <Button variant="outline" size="sm" className="gap-2" disabled={loading} onClick={()=>setRefreshId(i=>i+1)}>
    <RefreshCw className={'size-4 '+(loading?'animate-spin':'')}/> Atualizar
   </Button>
  </header>
  {error&&<p role="alert" className="rounded-xl bg-destructive/10 p-3 text-sm text-destructive">{error}</p>}
  {totalRows>records.length&&<p className="rounded-xl bg-amber-50 p-3 text-xs text-amber-900 dark:bg-amber-950/40 dark:text-amber-100">Extrato parcial: existem mais movimentações do que as exibidas nesta consulta.</p>}
  <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-3">
   <section className={surface+' flex min-h-[190px] flex-col gap-4 p-4 lg:col-span-2'}>
    <div className="flex items-start justify-between gap-3">
     <div><h2 className={heading}>Saldo previsto</h2>
      <p className="mt-3 text-2xl font-bold tracking-tight sm:text-3xl">Aguardando saldos reais</p>
      <p className={label+' mt-2'}>Uma previsão exige saldos verificados e compromissos futuros identificados.</p>
     </div><Illustration kind="wallet"/>
    </div>
    <div className="h-2 rounded-full bg-muted"/>
    <div className="grid grid-cols-2 gap-3 border-t border-border/50 pt-3 text-xs sm:grid-cols-4">
     <div><p className={label}>Entradas registradas</p><strong>{loading?'Carregando…':money(summary.incomingCents)}</strong></div>
     <div><p className={label}>Saídas registradas</p><strong>{loading?'Carregando…':money(summary.outgoingCents)}</strong></div>
     <div><p className={label}>Contas futuras</p><strong>Não confirmadas</strong></div>
     <div><p className={label}>Saldo projetado</p><strong>Indisponível</strong></div>
    </div>
   </section>

   <section className={surface+' flex min-h-[190px] flex-col gap-3 p-4'}>
    <div className="flex items-start justify-between"><div><h2 className={heading}>Contas a pagar</h2><p className={label}>Próximos compromissos</p></div><Illustration kind="calendar"/></div>
    <p className="text-lg font-bold">Aguardando confirmação</p>
    <div className="rounded-lg border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">Nenhum vencimento confirmado para exibir.</div>
    <p className={label+' border-t border-border/50 pt-3'}>
     {pendingCount===null?'Consultando agendamentos…':pendingCount===0?'Nenhum lançamento bancário pendente neste mês.':
      String(pendingCount)+' lançamento(s) pendente(s) no banco. Ainda não são contas confirmadas.'}
    </p>
   </section>

   <section className={surface+' flex min-h-[420px] flex-col p-4'}>
    <div className="flex items-start justify-between gap-2"><div><h2 className={heading}>Gastos da casa</h2><p className={label+' mt-1'}>Despesas de moradia identificadas</p>
     <p className="mt-2 text-2xl font-bold">{homeLines.length?money(summary.housingCents):'Não identificado'}</p></div><Illustration kind="balance"/></div>
    <div className="mt-4 border-b border-border/50 pb-3"><p className={label}>Participação individual não informada</p><div className="mt-2 h-2 rounded-full bg-muted"/></div>
    <h3 className="mt-4 text-xs font-semibold">Principais despesas da casa</h3>
    <div className="mt-2 flex-1">
     {homeLines.length?homeLines.slice(0,7).map((line,i)=><div key={line.label} className="flex justify-between gap-3 border-b border-border/50 py-2 text-xs">
      <span className="flex items-center gap-2"><i aria-hidden className={'size-1.5 shrink-0 rounded-full '+(i===0?'bg-rose-500':'bg-blue-500')}/>{line.label}</span>
      <strong className="tabular-nums">{money(line.amountCents)}</strong>
     </div>):<LoadingHint>Nenhuma despesa pôde ser classificada como moradia com segurança neste período.</LoadingHint>}
    </div>
    <p className={label+' mt-3 border-t border-border/50 pt-3'}>Transferências e pagamentos de cartão não são assumidos como gastos de moradia.</p>
   </section>

   <section className={surface+' flex min-h-[420px] flex-col p-4'}>
    <div className="flex items-start justify-between gap-2"><div><h2 className={heading}>Cartões</h2><p className={label+' mt-1'}>Cartões identificados pela Pluggy</p></div><Illustration kind="card"/></div>
    <div className="mt-4 flex-1">
     {selected?<div className="space-y-4"><CreditCardFace account={selected}/>
      <div className="flex items-center justify-between gap-2"><div className="min-w-0"><p className={label}>Saldo informado pelo banco</p><strong className="text-lg">
       {selected.currency==='BRL'&&typeof selected.credit?.reportedBalanceCents==='number'?money(selected.credit.reportedBalanceCents):'Não informada'}
      </strong></div>
      <div className="flex gap-1"><Button type="button" size="icon-sm" variant="outline" disabled={(cards?.length??0)<2} aria-label="Cartão anterior" onClick={()=>setCardIndex(i=>(i+(cards?.length??1)-1)%(cards?.length??1))}><ChevronLeft/></Button>
      <Button type="button" size="icon-sm" variant="outline" disabled={(cards?.length??0)<2} aria-label="Próximo cartão" onClick={()=>setCardIndex(i=>(i+1)%(cards?.length??1))}><ChevronRight/></Button></div></div>
      <div className="grid grid-cols-2 gap-2 rounded-xl bg-muted/40 p-3 text-xs">
       <div><p className={label}>Vencimento informado</p><strong>{selected.credit?.dueDate?formatBillingDate(selected.credit.dueDate):'Não informado'}</strong></div>
       <div><p className={label}>Limite disponível</p><strong>{selected.currency==='BRL'&&typeof selected.credit?.availableLimitCents==='number'?money(selected.credit.availableLimitCents):'Não informado'}</strong></div>
       <div><p className={label}>Limite total</p><strong>{selected.currency==='BRL'&&typeof selected.credit?.creditLimitCents==='number'?money(selected.credit.creditLimitCents):'Não informado'}</strong></div>
      </div>
     </div>:<div className="flex h-full flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border bg-muted/20 p-5 text-center">
      <CreditCard className="size-12 text-muted-foreground"/>
      <p className="text-sm font-semibold">Cartões ainda não identificados</p>
      <p className={label}>{inventoryState==='loading'?'Consultando conexões…':inventoryState==='unavailable'?'Não foi possível consultar os cartões agora. Tente atualizar.':'Nenhum cartão de crédito foi retornado pelas conexões atuais.'}</p>
     </div>}
    </div>
    {selected&&<p className={label+' mt-3'}>Representação estilizada. O saldo pode refletir fatura ou limite utilizado, conforme a conexão. Datas de vencimento podem ser de ciclos anteriores e não confirmam contas futuras. Aparência física pendente de confirmação.</p>}
   </section>

   <section className={surface+' flex min-h-[420px] flex-col p-4'}>
    <div className="flex items-start justify-between gap-2"><div><h2 className={heading}>Moradia e custo de vida</h2><p className={label+' mt-1'}>Despesas identificadas</p>
     <p className="mt-2 text-2xl font-bold">{homeLines.length?money(summary.housingCents):'Não identificado'}</p>
     </div><Illustration kind="house"/></div>
    <p className={label+' mt-3'}>Percentual da renda ainda indisponível: receitas recorrentes precisam ser verificadas.</p>
    <div className="mt-4 flex gap-1 rounded-lg border border-border bg-muted/20 p-1 text-center text-xs">
     <span className="flex-1 rounded-md bg-card px-2 py-2 font-semibold">Sua renda</span><span className="flex-1 px-2 py-2 text-muted-foreground">Custo da casa</span>
    </div>
    <div className="mt-4 h-2 rounded-full bg-muted"/>
    <h3 className="mt-6 text-xs font-semibold">O que entra na conta</h3>
    <div className="mt-3 grid grid-cols-2 gap-3">
     {homeLines.length?homeLines.slice(0,6).map(line=><div key={line.label} className="flex items-center gap-2">
      <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-blue-50 text-blue-600 dark:bg-blue-950/40"><House className="size-4"/></span>
      <div className="min-w-0 text-xs"><p className="truncate text-muted-foreground">{line.label}</p><strong>{money(line.amountCents)}</strong></div>
     </div>):<div className="col-span-2"><LoadingHint>Aguardando identificação segura de aluguel, condomínio, energia e outras despesas.</LoadingHint></div>}
    </div>
    <p className={label+' mt-auto pt-4'}>Valores realizados, não compromissos futuros.</p>
   </section>

   <section className={surface+' flex items-center justify-between gap-3 p-4'}>
    <div><h2 className={heading}>Projeção do mês</h2><p className="mt-2 text-lg font-semibold">Aguardando dados</p><p className={label}>Saldos e compromissos verificados.</p></div>
    <Illustration kind="wallet"/>
   </section>
   <section className={surface+' flex items-center justify-between gap-3 p-4 xl:col-span-2'}>
    <div><h2 className={heading}>Metas e objetivos</h2><p className={label+' mt-2'}>Nenhuma meta financeira cadastrada no Facts.</p></div>
    <Illustration kind="target"/>
   </section>
  </div>

  <section className={surface+' space-y-3 p-4'}>
   <div className="flex items-center justify-between gap-2"><h2 className={heading}>Últimas movimentações — {caption}</h2>
    {onNavigate&&<Button variant="ghost" size="sm" onClick={()=>onNavigate('bank')}>Ver extrato</Button>}
   </div>
   {!summary.recent.length?<LoadingHint>Nenhuma movimentação confirmada neste período.</LoadingHint>:
    <div className="divide-y divide-border/60">
     {summary.recent.map(row=><div key={row.id} className="flex items-center justify-between gap-3 py-2 text-xs">
      <div className="flex min-w-0 items-center gap-2">
       <span className={'grid size-8 shrink-0 place-items-center rounded-lg '+(row.direction==='incoming'?'bg-emerald-50 text-emerald-700':'bg-rose-50 text-rose-700')}>
        {row.direction==='incoming'?<ArrowDownLeft className="size-4"/>:<ArrowUpRight className="size-4"/>}
       </span>
       <div className="min-w-0"><p className="truncate font-medium">{row.description?.trim()||row.category||'Movimentação bancária'}</p>
        <p className={label}>{formatDate(row.occurred_at)} · {row.institution||'Banco não informado'}</p></div>
      </div>
      <strong className="shrink-0 tabular-nums">{row.direction==='incoming'?'+':'−'} {money(row.amount_cents)}</strong>
     </div>)}
    </div>}
   <p className={label}>Movimentações bancárias ainda sujeitas à conciliação de transferências e pagamentos de cartão.</p>
  </section>
 </div>;
}
