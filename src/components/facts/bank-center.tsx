'use client';

import { useCallback,useEffect,useMemo,useState } from 'react';
import { AlertCircle,ArrowDownLeft,ArrowUpRight,CheckCircle2,RefreshCw } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card,CardContent,CardDescription,CardHeader,CardTitle } from '@/components/ui/card';
import { Select,SelectContent,SelectItem,SelectTrigger,SelectValue } from '@/components/ui/select';
import { supabase } from '@/lib/supabase/client';
import type { Fact } from '@/domain/core';
import { categories } from '@/domain/core';
import { dateLabel,errorMessage,money,today } from '@/domain/view';
import { calculateFinancialInsights } from '@/bank/insights';

type Ledger = {
 id:string; occurred_at:string; amount_cents:number; direction:string;
 description:string|null;institution:string|null;merchant_name:string|null;
 counterparty_name:string|null;classification:string|null;relevance:string;
 sync_state:string;fact_id:string|null;provider_transaction_id:string;
};
type Review = {
 id:string;transaction_id:string;reason:string;suggested_action:string;
 status:string;created_at:string;
};
type Setting = {last_synced_at:string|null;ledger_from:string;notify_from:string};
const perPage=100;
const reviewReason:Record<string,string>={
 pension_outside_window:'Possível pensão fora da janela habitual',
 pension_duplicate_month:'Já existe pensão registrada para este mês',
 agata_outgoing_other:'Transferência para Agata precisa de classificação',
 agata_incoming:'Valor recebido da Agata',
 possible_noah_expense:'Compra possivelmente relacionada ao Noah',
};
const actionLabels:Record<string,string>={
 pensao:'Pensão',adicional:'Transferência adicional',
 reembolso:'Reembolso / recebimento',noah_expense:'Gasto do Noah',ignore:'Não relacionado',
};
const actionsByReason:Record<string,string[]>={
 pension_outside_window:['pensao','adicional','ignore'],
 pension_duplicate_month:['pensao','adicional','ignore'],
 agata_outgoing_other:['adicional','pensao','ignore'],
 agata_incoming:['reembolso','ignore'],
 possible_noah_expense:['noah_expense','ignore'],
};

export function BankCenter({
  facts,userId,initialReview,onFactsChange,
}:{
  facts:readonly Fact[];userId:string;initialReview:string|null;
  onFactsChange:()=>Promise<void>;
}){
 const [rows,setRows]=useState<Ledger[]>([]);
 const [reviews,setReviews]=useState<Review[]>([]);
 const [reviewRows,setReviewRows]=useState<Ledger[]>([]);
 const [setting,setSetting]=useState<Setting|null>(null);
 const [loading,setLoading]=useState(true),[more,setMore]=useState(true),[fetching,setFetching]=useState(false);
 const [error,setError]=useState('');
 const [search,setSearch]=useState('');
 const load=useCallback(async(append=false)=>{
  setFetching(true);
  try{
   const start=append?rows.length:0;
   const txQuery=supabase.from('facts_bank_transactions')
    .select('id,occurred_at,amount_cents,direction,description,institution,merchant_name,counterparty_name,classification,relevance,sync_state,fact_id,provider_transaction_id')
    .eq('owner_id',userId).order('occurred_at',{ascending:false})
    .order('provider_transaction_id',{ascending:false}).range(start,start+perPage-1);
   const [tx,rv,settings]=await Promise.all([
    txQuery,
    supabase.from('facts_bank_reviews')
     .select('id,transaction_id,reason,suggested_action,status,created_at')
     .eq('owner_id',userId).eq('status','pending').order('created_at',{ascending:false}).limit(250),
    supabase.from('facts_bank_settings')
     .select('last_synced_at,ledger_from,notify_from').eq('owner_id',userId).maybeSingle(),
   ]);
   if(tx.error)throw tx.error;
   if(rv.error)throw rv.error;
   if(settings.error)throw settings.error;
   const reviewIds=(rv.data??[]).map(row=>row.transaction_id);
   const missing=reviewIds.filter(id=>!(tx.data??[]).some(row=>row.id===id));
   if(missing.length){
    const extra=await supabase.from('facts_bank_transactions')
     .select('id,occurred_at,amount_cents,direction,description,institution,merchant_name,counterparty_name,classification,relevance,sync_state,fact_id,provider_transaction_id')
     .eq('owner_id',userId).in('id',missing.slice(0,250));
    if(extra.error)throw extra.error;
    setReviewRows((extra.data??[]) as Ledger[]);
   }else setReviewRows([]);
   const received=(tx.data??[]) as Ledger[];
   setRows(previous=>append?[...previous,...received]:received);
   setMore(received.length===perPage);
   setReviews((rv.data??[]) as Review[]);
   setSetting(settings.data as Setting|null);
   setError('');
  }catch(e){setError(errorMessage(e));}
  finally{setLoading(false);setFetching(false);}
 },[rows.length,userId]);
 useEffect(()=>{
  void load(false);
  const timer=window.setInterval(()=>{
   if(document.visibilityState==='visible'&&navigator.onLine)void load(false);
  },60000);
  return ()=>window.clearInterval(timer);
 // Bank center loads its own live data. Subsequent page fetches use the current callback.
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[userId]);
 const insights=useMemo(()=>calculateFinancialInsights(facts,today()),[facts]);
 const indexed=useMemo(()=>new Map([...reviewRows,...rows].map(row=>[row.id,row])),[reviewRows,rows]);
 const filtered=useMemo(()=>rows.filter(row=>{
  const q=search.trim().toLocaleLowerCase('pt-BR');
  return !q||[row.description,row.merchant_name,row.counterparty_name,row.institution].some(
   value=>value?.toLocaleLowerCase('pt-BR').includes(q));
 }),[rows,search]);
 const related=rows.filter(row=>row.relevance==='agata'||row.relevance==='noah').length;
 const orderedReviews=useMemo(()=>[...reviews].sort((a,b)=>a.id===initialReview?-1:b.id===initialReview?1:0),[reviews,initialReview]);
 const lastSync=setting?.last_synced_at
  ?new Date(setting.last_synced_at).toLocaleString('pt-BR',{dateStyle:'short',timeStyle:'short'})
  :'Aguardando primeira sincronização';
 const refresh=()=>load(false);
 return <div className="space-y-5">
  <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
   <Metric label="Movimentações carregadas" value={String(rows.length)} detail="Extrato normalizado" />
   <Metric label="Relacionadas ao Noah" value={String(related)} detail="Dentro das movimentações carregadas" />
   <Metric label="Aguardando sua decisão" value={String(reviews.length)} detail="Sem contabilização antecipada" />
   <Metric label="Última conciliação" value={lastSync} detail="Pluggy / Ciclo" />
  </section>
  <div className="flex flex-wrap items-center justify-between gap-3">
   <div><h2 className="text-lg font-semibold">Central de conciliação</h2>
    <p className="text-sm text-muted-foreground">O extrato é preservado. Somente lançamentos confirmados entram nos gastos do Noah.</p></div>
   <Button variant="outline" onClick={()=>void refresh()} disabled={fetching}>
    <RefreshCw className={fetching?'animate-spin':''}/> Atualizar
   </Button>
  </div>
  {error&&<p role="alert" className="rounded-lg border border-destructive/30 p-3 text-sm text-destructive">{error}</p>}
  <section className="space-y-3">
   <h3 className="text-base font-semibold">Decisões necessárias {reviews.length>0&&<Badge variant="outline">{reviews.length}</Badge>}</h3>
   {reviews.length===0&&!loading&&<Card><CardContent className="flex items-center gap-3 py-4 text-sm text-muted-foreground">
    <CheckCircle2 className="size-5 shrink-0"/> Nenhuma movimentação aguardando confirmação.</CardContent></Card>}
   {orderedReviews.map(review=><ReviewCard key={review.id} review={review}
    transaction={indexed.get(review.transaction_id)??null}
    focused={initialReview===review.id}
    onSuccess={async()=>{await load(false);await onFactsChange();}}/>)}
  </section>
  <section className="space-y-3">
   <div><h3 className="text-base font-semibold">Inteligência financeira</h3>
    <p className="text-sm text-muted-foreground">Comparações só utilizam gastos confirmados do Noah.</p></div>
   {insights.alerts.length>0?<div className="grid gap-3 md:grid-cols-2">
    {insights.alerts.map(alert=><Card key={alert.category}><CardContent className="flex items-start gap-3 py-4">
     <AlertCircle className="mt-0.5 size-5 shrink-0 text-amber-600"/>
     <div className="min-w-0"><p className="font-medium">Atenção: {alert.label} aumentou {alert.increasePercent}%</p>
      <p className="text-sm text-muted-foreground">No mesmo período do mês anterior, passou de {money(alert.previousCents)} para {money(alert.currentCents)}.</p></div>
    </CardContent></Card>)}
   </div>:<Card><CardContent className="py-4 text-sm text-muted-foreground">
    Nenhum aumento expressivo identificado com base comparável neste mês.
   </CardContent></Card>}
   <Card><CardHeader><CardTitle className="text-base">Evolução dos últimos seis meses</CardTitle>
    <CardDescription>Despesas e transferências confirmadas, sem somar transações bancárias não classificadas.</CardDescription>
   </CardHeader><CardContent className="space-y-3">
    {insights.months.map(month=>{
     const max=Math.max(1,...insights.months.map(item=>item.totalCents));
     return <div key={month.month} className="grid grid-cols-[62px_1fr_auto] items-center gap-3 text-sm">
      <span className="text-muted-foreground">{month.month.slice(5)}/{month.month.slice(2,4)}</span>
      <div className="h-2.5 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary" style={{width:String(month.totalCents/max*100)+'%'}}/></div>
      <span className="min-w-24 text-right font-medium tabular-nums">{money(month.totalCents)}</span>
     </div>;
    })}
   </CardContent></Card>
  </section>
  <section className="space-y-3">
   <div className="flex flex-wrap items-center justify-between gap-2">
    <div><h3 className="text-base font-semibold">Extrato bancário</h3>
     <p className="text-sm text-muted-foreground">Entradas e saídas das contas conectadas. Histórico paginado.</p></div>
    <input aria-label="Buscar no extrato" value={search} onChange={e=>setSearch(e.target.value)}
     placeholder="Buscar estabelecimento ou descrição"
     className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm sm:w-72"/>
   </div>
   <Card><CardContent className="divide-y divide-border p-0">
    {loading&&<p className="p-4 text-sm text-muted-foreground">Carregando extrato…</p>}
    {!loading&&filtered.length===0&&<p className="p-4 text-sm text-muted-foreground">Nenhuma movimentação encontrada.</p>}
    {filtered.map(row=><div key={row.id} className="flex items-center gap-3 p-4">
     <span className="grid size-9 shrink-0 place-items-center rounded-full bg-muted">
      {row.direction==='incoming'?<ArrowDownLeft className="size-4"/>:<ArrowUpRight className="size-4"/>}
     </span>
     <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{row.merchant_name??row.counterparty_name??row.description??'Movimentação'}</p>
      <p className="truncate text-xs text-muted-foreground">{dateLabel(row.occurred_at)} · {row.institution??'Instituição não informada'}</p></div>
     <div className="shrink-0 text-right"><p className="text-sm font-semibold tabular-nums">
      {row.direction==='incoming'?'+':'−'} {money(row.amount_cents)}</p>
      <p className={row.sync_state==='needs_review'?'text-xs text-amber-600':'text-xs text-muted-foreground'}>{row.sync_state==='needs_review'?'Atenção: revisão necessária':row.classification? (actionLabels[row.classification]??row.classification):row.relevance==='unknown'?'Não classificado':row.relevance==='irrelevant'?'Não relacionado':row.relevance==='agata'?'Relacionado à Agata':'Possível Noah'}</p></div>
    </div>)}
   </CardContent></Card>
   {more&&<Button variant="outline" className="w-full" disabled={fetching} onClick={()=>void load(true)}>
    {fetching?'Carregando…':'Carregar mais movimentações'}
   </Button>}
  </section>
 </div>;
}

function Metric({label,value,detail}:{label:string;value:string;detail:string}){
 return <Card><CardContent className="space-y-1 py-4"><p className="text-xs text-muted-foreground">{label}</p>
  <p className="text-lg font-semibold tracking-tight">{value}</p>
  <p className="text-xs text-muted-foreground">{detail}</p></CardContent></Card>;
}

function ReviewCard({review,transaction,focused,onSuccess}:{
 review:Review;transaction:Ledger|null;focused:boolean;onSuccess:()=>Promise<void>;
}){
 const [action,setAction]=useState(review.suggested_action);
 const [category,setCategory]=useState('outros');
 const [competence,setCompetence]=useState(transaction?.occurred_at.slice(0,7)??today().slice(0,7));
 const [remember,setRemember]=useState(false);
 const [saving,setSaving]=useState(false),[error,setError]=useState('');
 const options=actionsByReason[review.reason]??['ignore'];
 const confirm=async()=>{
  setSaving(true);setError('');
  try{
   const {error:failure}=await supabase.rpc('facts_resolve_bank_review',{
    p_review_id:review.id,p_action:action,p_category:category,
    p_competence:action==='pensao'?competence:null,
    p_remember:remember,
   });
   if(failure)throw failure;
   await onSuccess();
   if(focused){
    const url=new URL(window.location.href);
    url.searchParams.delete('review');
    window.history.replaceState(null,'',url.pathname+url.search+url.hash);
   }
  }catch(e){setError(errorMessage(e));}
  finally{setSaving(false);}
 };
 return <Card className={focused?'border-primary ring-1 ring-primary':'border-border'}>
  <CardHeader className="pb-2"><CardTitle className="text-base">{reviewReason[review.reason]??'Movimentação para revisar'}</CardTitle>
   <CardDescription>{transaction?dateLabel(transaction.occurred_at)+' · '+(transaction.institution??'Banco'):'Movimentação do extrato'}</CardDescription></CardHeader>
  <CardContent className="space-y-4">
   <div className="text-sm"><p className="font-semibold">{transaction?money(transaction.amount_cents):'Valor não carregado'}</p>
    <p className="text-muted-foreground">{transaction?.counterparty_name??transaction?.merchant_name??transaction?.description??'Consulte o extrato para detalhes'}</p></div>
   <div className="grid gap-3 sm:grid-cols-2">
    <label className="space-y-1 text-sm"><span className="font-medium">Como classificar?</span>
     <Select value={action} onValueChange={value=>setAction(String(value))}>
      <SelectTrigger className="w-full"><SelectValue/></SelectTrigger>
      <SelectContent>{options.map(option=><SelectItem key={option} value={option}>{actionLabels[option]??option}</SelectItem>)}</SelectContent>
     </Select></label>
    {action==='pensao'&&<label className="space-y-1 text-sm"><span className="font-medium">Competência da pensão</span>
     <input type="month" value={competence} onChange={e=>setCompetence(e.target.value)} required
      className="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm"/></label>}
    {action==='noah_expense'&&<label className="space-y-1 text-sm"><span className="font-medium">Categoria</span>
     <Select value={category} onValueChange={value=>setCategory(String(value))}>
      <SelectTrigger className="w-full"><SelectValue/></SelectTrigger>
      <SelectContent>{Object.entries(categories).map(([key,value])=><SelectItem key={key} value={key}>{value}</SelectItem>)}</SelectContent>
     </Select></label>}
   </div>
   {(action==='noah_expense'||action==='ignore')&&Boolean(transaction?.merchant_name)&&
    <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={remember}
     onChange={event=>setRemember(event.target.checked)} className="size-4 accent-primary"/>
     Lembrar esta decisão para futuras compras no mesmo estabelecimento</label>}
   {error&&<p role="alert" className="text-sm text-destructive">{error}</p>}
   <Button onClick={()=>void confirm()} disabled={saving||!transaction||action==='pensao'&&!/^\d{4}-\d{2}$/.test(competence)}>
    {saving?'Confirmando…':'Confirmar decisão'}
   </Button>
  </CardContent>
 </Card>;
}
