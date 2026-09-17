import type {Page} from '@playwright/test';

export const authCookieName='sb-gpbsjmagjxpnoooldgtk-auth-token';

export async function installSessionCookie(page:Page,session:unknown){
 const encoded='base64-'+Buffer.from(JSON.stringify(session)).toString('base64url');
 await page.addInitScript(({name,value})=>{document.cookie=`${name}=${value}; Path=/; SameSite=Lax`;},{name:authCookieName,value:encoded});
}

export function fakeSession(userId=crypto.randomUUID(),email='teste@example.com'){
 const now=new Date().toISOString(),epoch=Math.floor(Date.now()/1000),encode=(value:unknown)=>Buffer.from(JSON.stringify(value)).toString('base64url');
 const access_token=`${encode({alg:'HS256',typ:'JWT'})}.${encode({sub:userId,role:'authenticated',aud:'authenticated',exp:epoch+3600,iat:epoch})}.test`;
 return {access_token,refresh_token:'fake-refresh',expires_in:3600,expires_at:epoch+3600,token_type:'bearer',user:{id:userId,aud:'authenticated',role:'authenticated',email,app_metadata:{provider:'email',providers:['email']},user_metadata:{},created_at:now,updated_at:now}};
}
