import {useEffect,useState} from 'react';
import {ShieldCheck} from 'lucide-react';
import {supabase} from '../../lib/supabase/client';
import {errorMessage} from '../../domain/view';
import {authorizationIdFromUrl,scopeLabels} from './oauth-consent';
import {Button} from '@/components/ui/button';
import {Card,CardContent,CardDescription,CardFooter,CardHeader,CardTitle} from '@/components/ui/card';
import {Badge} from '@/components/ui/badge';

type ConsentDetails={
 authorization_id:string;
 redirect_uri:string;
 client:{id:string;name:string;uri:string;logo_uri:string};
 user:{id:string;email:string};
 scope:string;
};

export function OAuthConsent(){
 const authorizationId=authorizationIdFromUrl(window.location.href);
 const [details,setDetails]=useState<ConsentDetails|null>(null),[busy,setBusy]=useState(true),[message,setMessage]=useState('');
 useEffect(()=>{
  let active=true;
  async function load(){
   if(!authorizationId){setMessage('Solicitação OAuth inválida ou expirada.');setBusy(false);return;}
   try{
    const {data,error}=await supabase.auth.oauth.getAuthorizationDetails(authorizationId);
    if(error)throw error;
    if(!data)throw new Error('Não foi possível carregar a autorização OAuth.');
    if('redirect_url' in data){window.location.assign(data.redirect_url);return;}
    if(active)setDetails(data as ConsentDetails);
   }catch(error){if(active)setMessage(errorMessage(error));}
   finally{if(active)setBusy(false);}
  }
  void load();
  return()=>{active=false;};
 },[authorizationId]);

 async function decide(allow:boolean){
  if(!authorizationId)return;
  setBusy(true);setMessage('');
  try{
   const response=allow
    ?await supabase.auth.oauth.approveAuthorization(authorizationId,{skipBrowserRedirect:true})
    :await supabase.auth.oauth.denyAuthorization(authorizationId,{skipBrowserRedirect:true});
   if(response.error)throw response.error;
   if(!response.data?.redirect_url)throw new Error('O provedor OAuth não retornou a URL de continuação.');
   window.location.assign(response.data.redirect_url);
  }catch(error){setMessage(errorMessage(error));setBusy(false);}
 }

 const scopes=details?scopeLabels(details.scope):[];
 return <main className="grid min-h-svh lg:grid-cols-[1.05fr_1fr]">
  <section className="flex min-h-72 flex-col justify-center bg-gradient-to-br from-neutral-700 via-neutral-950 to-black px-7 py-10 text-white lg:min-h-svh lg:px-[8vw]">
   <img src="/icon.svg" width="58" height="58" alt="" className="mb-8 size-12 lg:size-14"/>
   <Badge variant="outline" className="mb-5 border-white/15 bg-white/5 text-neutral-300">FACTS • ACESSO PELO CHATGPT</Badge>
   <h1 className="max-w-xl text-4xl font-semibold tracking-[-0.055em] sm:text-5xl lg:text-6xl">Seus fatos.<br/>Sob seu controle.</h1>
   <p className="mt-5 max-w-md text-sm leading-7 text-neutral-300">O acesso usa sua conta do Facts e continua sujeito às mesmas regras de privacidade e isolamento por usuário.</p>
  </section>
  <section className="flex items-center justify-center bg-background p-5 sm:p-8">
   <Card className="w-full max-w-md shadow-sm">
    <CardHeader><div className="mb-2 grid size-10 place-items-center rounded-lg bg-primary text-primary-foreground"><ShieldCheck className="size-5"/></div><CardTitle className="text-xl"><h2>Permitir acesso ao Facts?</h2></CardTitle><CardDescription>Você mantém o controle da autorização.</CardDescription></CardHeader>
    <CardContent className="grid gap-4">
     {busy&&!details&&<p className="text-sm text-muted-foreground">Carregando a solicitação…</p>}
     {details&&<><p className="text-sm"><strong>{details.client.name}</strong> está solicitando acesso à sua conta Facts.</p><div className="grid gap-3 rounded-lg border bg-muted/35 p-3 text-sm"><div><span className="text-xs font-medium text-muted-foreground">Conta</span><p className="mt-1 break-all text-foreground">{details.user.email}</p></div><div><span className="text-xs font-medium text-muted-foreground">Permissões solicitadas</span><p className="mt-1 text-foreground">{scopes.join(', ')||'Acesso autenticado'}</p></div><div><span className="text-xs font-medium text-muted-foreground">Retorno</span><p className="mt-1 break-all text-xs text-foreground">{details.redirect_uri}</p></div></div></>}
     {message&&<p role="alert" className="rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-sm text-destructive">{message}</p>}
     <p className="text-xs leading-5 text-muted-foreground">O cliente não recebe sua senha. O acesso pode ser revogado pelo sistema de autorização.</p>
    </CardContent>
    {details&&<CardFooter className="gap-2"><Button type="button" disabled={busy} onClick={()=>void decide(true)}>{busy?'Aguarde…':'Permitir acesso'}</Button><Button type="button" variant="outline" disabled={busy} onClick={()=>void decide(false)}>Negar</Button></CardFooter>}
   </Card>
  </section>
 </main>;
}
