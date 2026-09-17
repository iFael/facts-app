import {test,expect} from '@playwright/test';
import {installSessionCookie} from './session-cookie';

function recoverySession(){
 const now=Math.floor(Date.now()/1000),user={id:'22222222-2222-4222-8222-222222222222',aud:'authenticated',role:'authenticated',email:'existente@example.com',app_metadata:{provider:'email',providers:['email']},user_metadata:{},identities:[],created_at:new Date().toISOString(),updated_at:new Date().toISOString()};
 const encode=(value:unknown)=>Buffer.from(JSON.stringify(value)).toString('base64url');
 const access_token=`${encode({alg:'HS256',typ:'JWT'})}.${encode({sub:user.id,role:'authenticated',aud:'authenticated',exp:now+3600,iat:now})}.test`;
 return {user,session:{access_token,token_type:'bearer',expires_in:3600,expires_at:now+3600,refresh_token:'refresh-token',user}};
}

test('reenvia confirmação para a origem atual sem afirmar entrega e aplica cooldown',async({page})=>{
 let resendBody:unknown,resendUrl='';
 await page.route('**/functions/v1/check-email*',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({status:'new'})}));
 await page.route('**/auth/v1/signup*',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({id:'11111111-1111-4111-8111-111111111111',aud:'authenticated',role:'authenticated',email:'teste@example.com',app_metadata:{},user_metadata:{},identities:[],created_at:new Date().toISOString(),updated_at:new Date().toISOString()})}));
 await page.route('**/auth/v1/resend*',async route=>{resendBody=route.request().postDataJSON();resendUrl=route.request().url();await route.fulfill({status:200,contentType:'application/json',body:'{}'});});
 await page.goto('/');
 await page.getByRole('button',{name:'Primeiro acesso? Criar conta'}).click();
 await page.getByLabel('E-mail',{exact:true}).fill('teste@example.com');
 await page.getByLabel('Senha',{exact:true}).fill('senha-segura-123');
 await page.getByRole('button',{name:'Criar acesso',exact:true}).click();
 await expect(page.getByText('Confirme seu e-mail',{exact:false})).toBeVisible();
 const resend=page.getByRole('button',{name:'Reenviar e-mail de confirmação',exact:true});
 await expect(resend).toBeVisible();
 await resend.click();
 await expect(page.getByText('Solicitação de confirmação enviada ao provedor.',{exact:false})).toBeVisible();
 await expect(page.getByRole('button',{name:/Reenviar em \d+s/})).toBeDisabled();
 expect(resendBody).toMatchObject({email:'teste@example.com',type:'signup'});
 expect(decodeURIComponent(resendUrl)).toContain('redirect_to=http://127.0.0.1:4173');
});

test('informa conta já cadastrada sem tentar criar usuário novamente',async({page})=>{
 let signupCalls=0;
 await page.route('**/functions/v1/check-email*',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({status:'confirmed'})}));
 await page.route('**/auth/v1/signup*',route=>{signupCalls++;return route.fulfill({status:200,contentType:'application/json',body:'{}'});});
 await page.goto('/');
 await page.getByRole('button',{name:'Primeiro acesso? Criar conta'}).click();
 await page.getByLabel('E-mail',{exact:true}).fill('existente@example.com');
 await page.getByLabel('Senha',{exact:true}).fill('senha-segura-123');
 await page.getByRole('button',{name:'Criar acesso',exact:true}).click();
 await expect(page.getByText('Este e-mail já possui uma conta.',{exact:false})).toBeVisible();
 expect(signupCalls).toBe(0);
});

test('solicita recuperação de senha para a origem atual sem revelar se a conta existe',async({page})=>{
 let recoverBody:unknown,recoverUrl='';
 await page.route('**/auth/v1/recover*',async route=>{recoverBody=route.request().postDataJSON();recoverUrl=route.request().url();await route.fulfill({status:200,contentType:'application/json',body:'{}'});});
 await page.goto('/');
 await page.getByRole('button',{name:'Esqueci minha senha'}).click();
 await page.getByLabel('E-mail',{exact:true}).fill('existente@example.com');
 await page.getByRole('button',{name:'Enviar link de recuperação',exact:true}).click();
 await expect(page.getByText('Se existir uma conta para este e-mail',{exact:false})).toBeVisible();
 expect(recoverBody).toMatchObject({email:'existente@example.com'});
 expect(decodeURIComponent(recoverUrl)).toContain('redirect_to=http://127.0.0.1:4173');
});

test('permite definir nova senha ao abrir uma sessão de recuperação',async({page})=>{
 const {user,session}=recoverySession(),newPassword=['nova','senha','1234'].join('-');let updateBody:unknown;
 await installSessionCookie(page,session);
 await page.route('**/auth/v1/user*',async route=>{if(route.request().method()==='PUT')updateBody=route.request().postDataJSON();await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(user)});});
 await page.goto(`/#access_token=${session.access_token}&expires_in=3600&refresh_token=${session.refresh_token}&token_type=bearer&type=recovery`);
 await expect(page.getByRole('heading',{name:'Defina uma nova senha'})).toBeVisible();
 await page.getByLabel('Nova senha',{exact:true}).fill(newPassword);
 await page.getByLabel('Confirmar nova senha',{exact:true}).fill(newPassword);
 await page.getByRole('button',{name:'Salvar nova senha',exact:true}).click();
 await expect(page.getByText('Senha atualizada com sucesso.',{exact:false})).toBeVisible();
 expect(updateBody).toMatchObject({password:newPassword});
});

test('exibe e aprova solicitação OAuth sem abrir o workspace legado',async({page})=>{
 const {user,session}=recoverySession();let consentBody:unknown;
 await installSessionCookie(page,session);
 await page.route('**/auth/v1/oauth/authorizations/auth-123',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({authorization_id:'auth-123',redirect_uri:'https://client.example/callback',client:{id:'client-123',name:'ChatGPT',uri:'https://chatgpt.com',logo_uri:''},user:{id:user.id,email:user.email},scope:'openid profile email'})}));
 await page.route('**/auth/v1/oauth/authorizations/auth-123/consent',async route=>{consentBody=route.request().postDataJSON();await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({redirect_url:'https://client.example/callback?code=ok'})});});
 await page.route('https://client.example/**',route=>route.fulfill({status:200,contentType:'text/html',body:'<html><body>ok</body></html>'}));
 await page.goto('/?authorization_id=auth-123');
 await expect(page.getByRole('heading',{name:'Permitir acesso ao Facts?'})).toBeVisible();
 await expect(page.getByText('ChatGPT',{exact:true})).toBeVisible();
 await expect(page.getByText('Permissões solicitadas',{exact:true}).locator('..')).toContainText('openid, profile, email');
 await page.getByRole('button',{name:'Permitir acesso',exact:true}).click();
 await page.waitForURL('https://client.example/callback?code=ok');
 expect(consentBody).toEqual({action:'approve'});
});
