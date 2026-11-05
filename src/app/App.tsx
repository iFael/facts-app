'use client';

import {useEffect,useRef,useState} from 'react';
import {RefreshCw,Search} from 'lucide-react';
import {Badge} from '@/components/ui/badge';
import {Button} from '@/components/ui/button';
import {Card,CardContent,CardDescription,CardHeader,CardTitle} from '@/components/ui/card';
import {Field,FieldLabel} from '@/components/ui/field';
import {InputGroup,InputGroupAddon,InputGroupInput} from '@/components/ui/input-group';
import {Select,SelectContent,SelectItem,SelectTrigger,SelectValue} from '@/components/ui/select';
import {SidebarInset,SidebarProvider} from '@/components/ui/sidebar';
import {OverviewCards} from '@/components/facts/overview-cards';
import {MonthPicker} from '@/components/facts/month-picker';
import {OverviewChart} from '@/components/facts/overview-chart';
import {WorkspaceSidebar,type WorkspaceTab} from '@/components/facts/workspace-sidebar';
import {ThemeSwitch} from '@/components/facts/theme-switch';
import {RecentFacts} from '@/components/facts/recent-facts';
import {StatementView} from '@/components/facts/statement-view';
import {DocumentsView} from '@/components/facts/documents-view';
import {ReportsView} from '@/components/facts/reports-view';
import {BankCenter} from '@/components/facts/bank-center';
import {MobileNavigation} from '@/components/facts/mobile-navigation';
import {useServiceWorkerUpdate} from './use-service-worker';
import {supabase,migrateLegacySession} from '../lib/supabase/client';
import {Auth} from '../features/auth/Auth';
import {OAuthConsent} from '../features/auth/OAuthConsent';
import {authorizationIdFromUrl} from '../features/auth/oauth-consent';
import {useFacts} from './use-facts';
import {categories,errorMessage,kinds,summarize,today} from '../domain/view';
import {Timeline} from '../features/timeline/Timeline';
import {DataPanel} from '../features/backup/DataPanel';

function recoveryFromUrl(){return new URLSearchParams(window.location.hash.slice(1)).get('type')==='recovery';}
function Notice({children,error=false}:{children:React.ReactNode;error?:boolean}){return <div className={error?'rounded-xl border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm text-destructive':'rounded-xl border border-border bg-card px-4 py-3 text-sm text-foreground shadow-xs'}>{children}</div>}

export function App(){
 const serviceWorker=useServiceWorkerUpdate();
 const recoveryRef=useRef(false),oauthRef=useRef(false),[recovery,setRecovery]=useState(false);
 const [userId,setUserId]=useState<string|null>(null),[loading,setLoading]=useState(true),[authError,setAuthError]=useState('');
 useEffect(()=>{recoveryRef.current=recoveryFromUrl();oauthRef.current=Boolean(authorizationIdFromUrl(window.location.href));setRecovery(recoveryRef.current);const apply=(id?:string)=>{if(recoveryRef.current){setLoading(false);return;}if(oauthRef.current){setUserId(id??null);setLoading(false);return;}setUserId(id??null);if(id)localStorage.setItem('facts-last-user',id);setLoading(false);};const {data}=supabase.auth.onAuthStateChange((event,session)=>{if(event==='PASSWORD_RECOVERY'){recoveryRef.current=true;setRecovery(true);setUserId(null);setLoading(false);return;}apply(session?.user.id);});if(!navigator.onLine){if(recoveryRef.current)setLoading(false);else if(oauthRef.current){setAuthError('A autorização do ChatGPT exige conexão com a internet.');setLoading(false);}else apply(localStorage.getItem('facts-last-user')??undefined);return()=>data.subscription.unsubscribe();}void migrateLegacySession().then(()=>supabase.auth.getSession()).then(({data:sessionData,error})=>{if(error)setAuthError(error.message);apply(sessionData.session?.user.id);}).catch(e=>{setAuthError(errorMessage(e));setLoading(false);});return()=>data.subscription.unsubscribe();},[]);
 if(loading)return <main className="grid min-h-dvh place-content-center justify-items-center gap-4 bg-background"><img src="/icon.svg" width="48" alt="Facts" className="size-12 rounded-2xl"/><p className="text-sm text-muted-foreground">Abrindo seu espaço…</p></main>;
 if(recovery)return <>{authError&&<div className="fixed inset-x-4 top-4 z-50"><Notice error>{authError}</Notice></div>}<Auth recovery onRecoveryComplete={id=>{recoveryRef.current=false;setRecovery(false);setUserId(id);localStorage.setItem('facts-last-user',id);}}/></>;
 if(oauthRef.current)return userId?<OAuthConsent/>:<>{authError&&<div className="fixed inset-x-4 top-4 z-50"><Notice error>{authError}</Notice></div>}<Auth/></>;
 return userId?<Workspace key={userId} userId={userId} serviceWorker={serviceWorker}/>:<>{authError&&<div className="fixed inset-x-4 top-4 z-50"><Notice error>{authError}</Notice></div>}<Auth/></>;
}

function Workspace({userId,serviceWorker}:{userId:string;serviceWorker:ReturnType<typeof useServiceWorkerUpdate>}){
 const {state,error,loading,refreshing,online,refresh,documentsService}=useFacts(userId);
 const [tab,setTab]=useState<WorkspaceTab>('home'),[requestedReview,setRequestedReview]=useState<string|null>(null),[month,setMonth]=useState(today().slice(0,7)),[search,setSearch]=useState(''),[filterKind,setFilterKind]=useState(''),[filterCategory,setFilterCategory]=useState('');
 useEffect(()=>{const id=new URLSearchParams(window.location.search).get('review');if(id){setRequestedReview(id);setTab('bank');}},[]);
 const changeTab=(next:WorkspaceTab)=>{if(['home','statement','reports'].includes(next)&&!month)setMonth(today().slice(0,7));setTab(next);};
 if(loading)return <main className="grid min-h-dvh place-content-center justify-items-center gap-3"><p className="text-sm text-muted-foreground">Carregando seus dados…</p>{error&&<p role="alert" className="text-sm text-destructive">{error}</p>}</main>;
 const dependentData=state?.dependent??null,allFacts=state?.facts??[],relationships=state?.relationships??[],documents=state?.documents??[],displayName=dependentData?.name?.trim()||'Seu dependente';
 const monthFacts=allFacts.filter(r=>!month||r.occurredAt.startsWith(month)),summary=summarize(allFacts,relationships,month);
 const filtered=allFacts.filter(r=>(!month||r.occurredAt.startsWith(month))&&(!filterKind||r.kind===filterKind)&&(!filterCategory||r.category===filterCategory)&&(!search||(r.title+' '+r.notes+' '+(r.sourceDetail??'')).toLocaleLowerCase('pt-BR').includes(search.toLocaleLowerCase('pt-BR')))&&(tab!=='requests'||r.kind==='request'));
 const updateAvailable=serviceWorker.updateAvailable,canApplyUpdate=updateAvailable&&online&&!refreshing,status=!online?'Offline':refreshing?'Atualizando…':error?'Falha ao atualizar':'Sincronizado',pendingStatus=!online||!!error;
 const title=tab==='home'?displayName:tab==='statement'?'Extrato':tab==='bank'?'Conciliação':tab==='facts'?'Fatos':tab==='requests'?'Solicitações':tab==='documents'?'Documentos':tab==='reports'?'Relatórios':'Meus dados';
 return <SidebarProvider defaultOpen className="min-h-dvh"><WorkspaceSidebar tab={tab} onTabChange={changeTab} dependentName={displayName}/><SidebarInset className="min-w-0 bg-background"><header className="sticky top-0 z-20 flex min-h-[calc(3.5rem+env(safe-area-inset-top))] items-center border-b border-border/80 bg-background/90 px-4 pt-[env(safe-area-inset-top)] backdrop-blur md:min-h-16 md:px-6 md:pt-0"><div className="mr-auto flex items-center gap-2 md:hidden"><button type="button" onClick={()=>changeTab('home')} aria-label="Ir para o início" className="grid min-h-11 min-w-11 place-items-center rounded-xl"><img src="/icon.svg" width="32" height="32" alt="Facts" className="size-8 rounded-xl"/></button><ThemeSwitch/></div><div className="ml-auto flex items-center gap-1.5">{updateAvailable?<Button variant="outline" size="sm" disabled={!canApplyUpdate} onClick={()=>void serviceWorker.applyUpdate()} className="min-h-11 gap-2 rounded-full border-sky-300 bg-sky-50 px-3 text-xs font-semibold text-sky-700 dark:border-sky-900 dark:bg-sky-950/45 dark:text-sky-300 md:min-h-7"><span className="size-1.5 rounded-full bg-sky-500"/>Atualizar</Button>:<Badge variant="outline" className={pendingStatus?'gap-2 border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300':'gap-2 border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300'} role="status"><span className={pendingStatus?'size-1.5 rounded-full bg-amber-500':'size-1.5 rounded-full bg-emerald-500'}/><span>{status}</span></Badge>}<Button variant="ghost" size="icon" className="size-11 md:size-9" aria-label="Atualizar dados" disabled={refreshing||!online} onClick={()=>void refresh()}><RefreshCw className={refreshing?'animate-spin':''}/></Button></div></header>
  <main className="mx-auto w-full max-w-[1420px] flex-1 px-4 pt-4 pb-[calc(5.5rem+env(safe-area-inset-bottom))] sm:px-6 md:px-8 md:py-10 md:pb-10"><div className="space-y-3">{error&&<Notice error>{error}{online&&<Button variant="link" className="ml-2 h-auto p-0 text-destructive" onClick={()=>void refresh()}>Tentar novamente</Button>}</Notice>}</div>{!dependentData?<Card className="mx-auto mt-8 max-w-xl sm:mt-14"><CardHeader><CardTitle>Nenhum dependente configurado</CardTitle><CardDescription>Envie as informações pelo ChatGPT. Elas aparecerão aqui automaticamente.</CardDescription></CardHeader><CardContent><p className="text-sm text-muted-foreground">O app é apenas para consulta.</p></CardContent></Card>:<div className="space-y-4 md:space-y-8"><section className="flex items-center"><h1 className="text-xl font-semibold tracking-[-.025em] sm:text-2xl">{title}</h1></section>{tab!=='data'&&tab!=='documents'&&tab!=='bank'&&<section className="flex flex-wrap items-center gap-2 md:gap-3"><Field className="w-auto"><FieldLabel className="sr-only">Mês dos registros</FieldLabel><MonthPicker label="Mês dos registros" value={month} onChange={setMonth}/></Field>{!['home','statement','reports'].includes(tab)&&<Button variant="ghost" size="sm" onClick={()=>setMonth('')}>Todo o histórico</Button>}</section>}
   {tab==='home'&&<><OverviewCards summary={summary}/><OverviewChart facts={allFacts} month={month}/><section className="space-y-3"><h2 className="text-lg font-semibold">Fatos recentes</h2><RecentFacts facts={monthFacts}/></section></>}
   {tab==='statement'&&<StatementView facts={allFacts} month={month}/>}
   {tab==='bank'&&<BankCenter facts={allFacts} userId={userId} initialReview={requestedReview} onFactsChange={refresh}/>}
   {(tab==='facts'||tab==='requests')&&<section className="space-y-4"><div className="flex flex-col gap-2 md:flex-row"><InputGroup className="h-9 flex-1 bg-background"><InputGroupAddon><Search/></InputGroupAddon><InputGroupInput aria-label="Buscar registros" placeholder="Buscar descrição, observação…" value={search} onChange={e=>setSearch(e.target.value)}/></InputGroup>{tab==='facts'&&<Select value={filterKind||'all'} onValueChange={value=>setFilterKind(value==='all'?'':String(value))}><SelectTrigger aria-label="Filtrar tipo" className="h-9 w-full bg-background md:w-[180px]"><SelectValue>{value=>value==='all'?'Todos os tipos':kinds[String(value) as keyof typeof kinds]??String(value)}</SelectValue></SelectTrigger><SelectContent><SelectItem value="all">Todos os tipos</SelectItem>{Object.entries(kinds).map(([k,v])=><SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent></Select>}<Select value={filterCategory||'all'} onValueChange={value=>setFilterCategory(value==='all'?'':String(value))}><SelectTrigger aria-label="Filtrar categoria" className="h-9 w-full bg-background md:w-[190px]"><SelectValue>{value=>value==='all'?'Todas as categorias':categories[String(value) as keyof typeof categories]??String(value)}</SelectValue></SelectTrigger><SelectContent><SelectItem value="all">Todas as categorias</SelectItem>{Object.entries(categories).map(([k,v])=><SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent></Select></div><Timeline facts={filtered} relationships={relationships} documents={documents} documentsService={documentsService}/></section>}
   {tab==='documents'&&<DocumentsView documents={documents} facts={allFacts} documentsService={documentsService}/>}
   {tab==='reports'&&<ReportsView facts={allFacts} relationships={relationships} month={month}/>}
   {tab==='data'&&<DataPanel dependent={dependentData} documents={documents}/>}
  </div>}</main><MobileNavigation tab={tab} onTabChange={changeTab}/></SidebarInset></SidebarProvider>;
}
