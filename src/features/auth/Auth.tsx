'use client';

import {useEffect,useState,type FormEvent} from 'react';
import {Button} from '@/components/ui/button';
import {Card,CardContent,CardDescription,CardHeader,CardTitle} from '@/components/ui/card';
import {Field,FieldGroup,FieldLabel} from '@/components/ui/field';
import {Input} from '@/components/ui/input';
import {supabase} from '../../lib/supabase/client';
import {errorMessage} from '../../domain/view';

type RegistrationStatus='new'|'pending'|'confirmed';
type AuthProps={recovery?:boolean;onRecoveryComplete?:(userId:string)=>void};

export function Auth({recovery=false,onRecoveryComplete}:AuthProps){
 const [email,setEmail]=useState(''),[password,setPassword]=useState(''),[confirmPassword,setConfirmPassword]=useState(''),[signup,setSignup]=useState(false),[forgot,setForgot]=useState(false),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[pendingEmail,setPendingEmail]=useState(''),[cooldown,setCooldown]=useState(0),[recoveredUserId,setRecoveredUserId]=useState('');
 useEffect(()=>{if(cooldown<=0)return;const timer=window.setInterval(()=>setCooldown(v=>Math.max(0,v-1)),1000);return()=>window.clearInterval(timer);},[cooldown]);
 async function submit(e:FormEvent){e.preventDefault();setBusy(true);setMessage('');
 try{
  if(recovery){
   if(password!==confirmPassword){setMessage('As senhas informadas não coincidem.');return;}
   const {data,error}=await supabase.auth.updateUser({password});if(error)throw error;
   if(!data.user?.id)throw new Error('Não foi possível confirmar a sessão de recuperação.');
   setRecoveredUserId(data.user.id);setMessage('Senha atualizada com sucesso. Você pode continuar para o Facts.');return;
  }
  if(forgot){const {error}=await supabase.auth.resetPasswordForEmail(email,{redirectTo:window.location.origin});if(error)throw error;setMessage('Se existir uma conta para este e-mail, você receberá um link para redefinir sua senha. Verifique também a pasta de spam.');return;}
  if(signup){
   const {data:lookup,error:lookupError}=await supabase.functions.invoke<{status:RegistrationStatus}>('check-email',{body:{email}});
   if(lookupError)throw lookupError;
   if(lookup?.status==='confirmed'){setPendingEmail('');setMessage('Este e-mail já possui uma conta. Use “Já tenho acesso” para entrar.');return;}
   if(lookup?.status==='pending'){setPendingEmail(email);setMessage('Este e-mail já está cadastrado, mas ainda precisa ser confirmado. Você pode reenviar a confirmação abaixo.');return;}
  }
  const {data,error}=signup?await supabase.auth.signUp({email,password,options:{emailRedirectTo:window.location.origin}}):await supabase.auth.signInWithPassword({email,password});
  if(error)throw error;
  if(signup&&!data.session){setPendingEmail(email);setMessage('Confirme seu e-mail e volte aqui para entrar. Se não encontrar a mensagem, você pode reenviar a confirmação abaixo.');}
  else setPendingEmail('');
 }catch(e){setMessage(errorMessage(e));}finally{setBusy(false);}
 }
 async function resend(){
  if(!pendingEmail||cooldown>0)return;setBusy(true);setMessage('');
  try{const {error}=await supabase.auth.resend({type:'signup',email:pendingEmail,options:{emailRedirectTo:window.location.origin}});if(error)throw error;setCooldown(60);setMessage('Solicitação de confirmação enviada ao provedor. Verifique sua caixa de entrada e spam; a entrega pode levar alguns minutos.');}
  catch(e){setMessage(errorMessage(e));}finally{setBusy(false);}
 }
 function resetMode(){setSignup(false);setForgot(false);setPendingEmail('');setMessage('');setCooldown(0);}
 const title=recovery?'Defina uma nova senha':forgot?'Recupere seu acesso':signup?'Crie seu acesso pessoal':'Seu histórico começa aqui.';
 const description=recovery?'Escolha uma nova senha com pelo menos 12 caracteres.':forgot?'Informe seu e-mail para receber um link seguro de redefinição de senha.':'Entre para manter uma cópia privada dos seus registros fora deste dispositivo.';
 return <main className="min-h-svh bg-background lg:grid lg:grid-cols-[1.05fr_1fr]">
  <section className="relative flex min-h-[310px] flex-col justify-center overflow-hidden bg-gradient-to-br from-neutral-800 via-neutral-950 to-black px-7 py-10 text-white sm:px-10 lg:min-h-svh lg:px-[8vw]">
   <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_18%_12%,rgba(255,255,255,.14),transparent_34%)]"/>
   <div className="relative max-w-xl">
    <img src="/icon.svg" width="54" height="54" alt="" className="mb-8 rounded-2xl ring-1 ring-white/15"/>
    <p className="mb-3 text-[10px] font-semibold tracking-[0.18em] text-neutral-400">FACTS • SEU ESPAÇO PESSOAL</p>
    <h1 className="max-w-lg text-4xl leading-[1.04] font-semibold tracking-[-0.045em] text-white sm:text-5xl lg:text-6xl">Mais clareza.<br/>Menos coisas<br/>para lembrar.</h1>
    <p className="mt-6 max-w-sm text-sm leading-7 text-neutral-300">Organize os cuidados, os gastos e os acontecimentos que importam. Tudo conectado aos fatos.</p>
    <p className="mt-12 hidden text-xs text-neutral-400 lg:block"><span className="mr-3 inline-grid size-8 place-items-center rounded-full border border-white/20 text-white">01</span>Registre. Organize. Tenha contexto.</p>
   </div>
  </section>
  <section className="flex items-center justify-center px-4 py-8 sm:px-8 lg:px-12">
   <Card className="w-full max-w-md border-0 shadow-[0_24px_80px_-36px_rgba(0,0,0,.28)] ring-1 ring-foreground/10">
    <CardHeader className="gap-2 px-6 pt-2 sm:px-7">
     <p className="text-[10px] font-semibold tracking-[0.16em] text-muted-foreground">BEM-VINDO AO FACTS</p>
     <CardTitle className="text-2xl tracking-[-0.025em] sm:text-[1.75rem]"><h2>{title}</h2></CardTitle>
     <CardDescription className="leading-6">{description}</CardDescription>
    </CardHeader>
    <CardContent className="space-y-4 px-6 pb-2 sm:px-7">
     {!recoveredUserId&&<form onSubmit={submit}>
      <FieldGroup>
       {recovery?<>
        <Field><FieldLabel htmlFor="new-password">Nova senha</FieldLabel><Input id="new-password" type="password" minLength={12} autoComplete="new-password" required value={password} onChange={e=>setPassword(e.target.value)}/></Field>
        <Field><FieldLabel htmlFor="confirm-password">Confirmar nova senha</FieldLabel><Input id="confirm-password" type="password" minLength={12} autoComplete="new-password" required value={confirmPassword} onChange={e=>setConfirmPassword(e.target.value)}/></Field>
       </>:<>
        <Field><FieldLabel htmlFor="auth-email">E-mail</FieldLabel><Input id="auth-email" type="email" autoComplete="email" required value={email} onChange={e=>setEmail(e.target.value)}/></Field>
        {!forgot&&<Field><FieldLabel htmlFor="auth-password">Senha</FieldLabel><Input id="auth-password" type="password" minLength={12} autoComplete={signup?'new-password':'current-password'} required value={password} onChange={e=>setPassword(e.target.value)}/></Field>}
       </>}
       <Button type="submit" size="lg" className="mt-1 w-full" disabled={busy}>{busy?'Aguarde…':recovery?'Salvar nova senha':forgot?'Enviar link de recuperação':signup?'Criar acesso':'Entrar no Facts'}</Button>
      </FieldGroup>
     </form>}
     {message&&<div role="alert" className="rounded-lg border border-border bg-muted/50 px-4 py-3 text-sm leading-6 text-foreground">{message}</div>}
     {recoveredUserId&&<Button size="lg" className="w-full" type="button" onClick={()=>onRecoveryComplete?.(recoveredUserId)}>Continuar para o Facts</Button>}
     {!recovery&&pendingEmail&&<Button variant="ghost" className="w-full justify-start px-0" type="button" disabled={busy||cooldown>0} onClick={()=>void resend()}>{cooldown>0?`Reenviar em ${cooldown}s`:'Reenviar e-mail de confirmação'}</Button>}
     {!recovery&&!signup&&!forgot&&<Button variant="ghost" className="w-full justify-start px-0" type="button" onClick={()=>{setForgot(true);setMessage('');}}>Esqueci minha senha</Button>}
     {!recovery&&<Button variant="link" className="h-auto w-full justify-start p-0" type="button" onClick={()=>{if(forgot)resetMode();else{setSignup(!signup);setPendingEmail('');setMessage('');setCooldown(0);}}}>{forgot?'Voltar para entrar':signup?'Já tenho acesso':'Primeiro acesso? Criar conta'}</Button>}
     <p className="pt-2 text-xs leading-5 text-muted-foreground">Uso individual. Seus dados não são compartilhados com outro responsável.</p>
    </CardContent>
   </Card>
  </section>
 </main>;
}
