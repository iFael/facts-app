'use client';

import {createBrowserClient} from '@supabase/ssr';
import {publishableKey,supabaseUrl} from './config';

export const supabase=createBrowserClient(supabaseUrl,publishableKey);

const legacyStorageKey=`sb-${new URL(supabaseUrl).hostname.split('.')[0]}-auth-token`;

export async function migrateLegacySession(){
 if(typeof window==='undefined')return;
 const raw=window.localStorage.getItem(legacyStorageKey);
 if(!raw)return;
 try{
  const value=JSON.parse(raw) as {access_token?:unknown;refresh_token?:unknown};
  if(typeof value.access_token!=='string'||typeof value.refresh_token!=='string')return;
  const {error}=await supabase.auth.setSession({access_token:value.access_token,refresh_token:value.refresh_token});
  if(!error)window.localStorage.removeItem(legacyStorageKey);
 }catch{
  // Sessão legada inválida permanece intocada; o fluxo normal de Auth decide o próximo passo.
 }
}
