import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {test,expect} from '@playwright/test';
import {authCookieName,installSessionCookie} from './session-cookie';

function validSession(){
 const now=Math.floor(Date.now()/1000),id='44444444-4444-4444-8444-444444444444';
 const encode=(value:unknown)=>Buffer.from(JSON.stringify(value)).toString('base64url');
 const user={id,aud:'authenticated',role:'authenticated',email:'update@example.com',app_metadata:{provider:'email',providers:['email']},user_metadata:{},created_at:new Date().toISOString(),updated_at:new Date().toISOString()};
 return {access_token:`${encode({alg:'HS256',typ:'JWT'})}.${encode({sub:id,role:'authenticated',aud:'authenticated',exp:now+3600,iat:now})}.test`,refresh_token:'refresh-update',expires_in:3600,expires_at:now+3600,token_type:'bearer',user};
}

test('detecta nova versão com a aba aberta e oferece Atualizar sem reload',async({page})=>{
 await installSessionCookie(page,validSession());
 await page.route('**/auth/v1/user*',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(validSession().user)}));
 await page.goto('/');
 await page.evaluate(async()=>{await navigator.serviceWorker.ready;});
 const swPath=path.join(process.cwd(),'public','sw.js');
 const original=await readFile(swPath,'utf8');
 try{
  await writeFile(swPath,`${original}\n// update-probe-${Date.now()}\n`,'utf8');
  await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
  await expect(page.getByRole('button',{name:'Atualizar',exact:true})).toBeVisible({timeout:15000});
 }finally{
  await writeFile(swPath,original,'utf8');
 }
});
