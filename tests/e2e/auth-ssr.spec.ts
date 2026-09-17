import {test,expect} from '@playwright/test';

const storageKey='sb-gpbsjmagjxpnoooldgtk-auth-token';

function session(){
 const now=Math.floor(Date.now()/1000),user={id:'33333333-3333-4333-8333-333333333333',aud:'authenticated',role:'authenticated',email:'cookie@example.com',app_metadata:{provider:'email',providers:['email']},user_metadata:{},identities:[],created_at:new Date().toISOString(),updated_at:new Date().toISOString()};
 const encode=(value:unknown)=>Buffer.from(JSON.stringify(value)).toString('base64url');
 const access_token=`${encode({alg:'HS256',typ:'JWT'})}.${encode({sub:user.id,role:'authenticated',aud:'authenticated',exp:now+3600,iat:now})}.test`;
 return {access_token,token_type:'bearer',expires_in:3600,expires_at:now+3600,refresh_token:'refresh-token-cookie',user};
}

test('persiste sessão web em cookie e não no localStorage legado',async({page})=>{
 const auth=session();
 await page.route('**/auth/v1/token?grant_type=password',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(auth)}));
 await page.goto('/');
 await page.getByLabel('E-mail',{exact:true}).fill('cookie@example.com');
 await page.getByLabel('Senha',{exact:true}).fill('senha-segura-123');
 await page.getByRole('button',{name:'Entrar no Facts',exact:true}).click();
 await expect.poll(()=>page.evaluate(key=>document.cookie.includes(key),storageKey)).toBe(true);
 expect(await page.evaluate(key=>localStorage.getItem(key),storageKey)).toBeNull();
});

test('migra uma sessão legada válida para cookie e remove o storage antigo',async({page})=>{
 const auth=session();
 await page.addInitScript(({key,value})=>localStorage.setItem(key,JSON.stringify(value)),{key:storageKey,value:auth});
 await page.route('**/auth/v1/user*',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(auth.user)}));
 await page.goto('/');
 await expect.poll(()=>page.evaluate(key=>document.cookie.includes(key),storageKey)).toBe(true);
 expect(await page.evaluate(key=>localStorage.getItem(key),storageKey)).toBeNull();
 await expect(page.getByLabel('Nome do dependente')).toHaveCount(0);
});
