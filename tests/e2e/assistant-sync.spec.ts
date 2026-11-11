import {test,expect} from '@playwright/test';
import {fakeSession,installSessionCookie} from './session-cookie';

const userId='55555555-5555-4555-8555-555555555555',dependentId='22222222-2222-4222-8222-222222222222';

test('fato criado externamente aparece ao voltar para a aba sem reload',async({page})=>{
 let externalFact=false;
 await installSessionCookie(page,fakeSession(userId));
 const json=(route:any,body:unknown)=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(body),headers:{'content-range':'0-0/1'}});
 await page.route(/\/rest\/v1\/facts_dependents\?/,route=>json(route,[{id:dependentId,name:'Dependente Teste',birth_date:'2025-01-01',created_at:'2026-09-14T19:19:05.368Z',updated_at:'2026-09-15T12:49:48.928Z'}]));
 await page.route(/\/rest\/v1\/facts_relationships\?/,route=>json(route,[]));
 await page.route(/\/rest\/v1\/facts_evidence\?/,route=>json(route,[]));
 await page.route(/\/rest\/v1\/facts\?/,route=>json(route,externalFact?[{id:'88888888-8888-4888-8888-888888888888',dependent_id:dependentId,kind:'event',title:'Atualização criada pelo ChatGPT',category:'outros',notes:'',occurred_at:'2026-09-15',amount_cents:null,transfer_purpose:null,request_total_cents:null,source:'chat',source_detail:null,created_by:'assistant',provenance_kind:'user_assertion',created_at:'2026-09-15T14:00:00.000Z',updated_at:'2026-09-15T14:00:00.000Z'}]:[]));
 await page.goto('/');
 await expect(page.getByRole('heading',{name:'Saldo previsto'})).toBeVisible();
 await page.getByRole('button',{name:'Fatos',exact:true}).click();
 await page.getByRole('button',{name:'Todo o histórico'}).click();
 await expect(page.getByText('Atualização criada pelo ChatGPT',{exact:true})).toHaveCount(0);
 externalFact=true;
 await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
 await expect(page.getByText('Atualização criada pelo ChatGPT',{exact:true})).toBeVisible();
});
