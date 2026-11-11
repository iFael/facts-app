import {test,expect} from '@playwright/test';
import {fakeSession,installSessionCookie} from './session-cookie';

const userId='66666666-6666-4666-8666-666666666666',dependentId='22222222-2222-4222-8222-222222222222';
const json=(route:any,body:unknown)=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(body),headers:{'content-range':'0-0/1'}});

test.use({viewport:{width:1280,height:900},isMobile:false,hasTouch:false});

test('Web/PWA é somente leitura; escritas ficam exclusivas do ChatGPT/MCP',async({page})=>{
 await installSessionCookie(page,fakeSession(userId));
 await page.route(/\/rest\/v1\/facts_dependents\?/,route=>json(route,[{id:dependentId,name:'Dependente Teste',birth_date:'2025-01-01',created_at:'2026-09-14T19:19:05.368Z',updated_at:'2026-09-15T12:49:48.928Z'}]));
 await page.route(/\/rest\/v1\/facts_relationships\?/,route=>json(route,[]));
 await page.route(/\/rest\/v1\/facts_evidence\?/,route=>json(route,[]));
 await page.route(/\/rest\/v1\/facts\?/,route=>json(route,[{id:'77777777-7777-4777-8777-777777777777',dependent_id:dependentId,kind:'expense',title:'Farmácia',category:'saude',notes:'Teste read-only',occurred_at:'2026-09-15',amount_cents:4890,transfer_purpose:null,request_total_cents:null,source:'chat',source_detail:null,created_by:'assistant',provenance_kind:'user_assertion',created_at:'2026-09-15T14:00:00.000Z',updated_at:'2026-09-15T14:00:00.000Z'}]));
 await page.goto('/');
 await expect(page.getByRole('heading',{name:'Saldo previsto'})).toBeVisible();
 await expect(page.getByRole('button',{name:/Registrar|Novo registro/i})).toHaveCount(0);
 await page.getByRole('button',{name:'Fatos',exact:true}).click();
 await page.getByRole('button',{name:'Todo o histórico'}).click();
 await page.getByText('Farmácia',{exact:true}).click();
 for(const action of ['Editar registro','Excluir registro','Registrar pagamento','Salvar nome','Restaurar'])await expect(page.getByRole('button',{name:action,exact:true})).toHaveCount(0);
 await page.getByLabel('Meus dados').click();
 await expect(page.getByText('Dependente',{exact:true})).toBeVisible();
 await expect(page.getByText('Conta',{exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'Sair da conta',exact:true})).toBeVisible();
 await expect(page.locator('input[type="file"], input[aria-label="Nome do dependente"]')).toHaveCount(0);
});
