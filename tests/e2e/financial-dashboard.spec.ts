import {test,expect} from '@playwright/test';
import {fakeSession,installSessionCookie} from './session-cookie';

test.use({viewport:{width:1440,height:900},isMobile:false,hasTouch:false});
const json=(route:any,body:unknown,total=0)=>route.fulfill({
 status:200,contentType:'application/json',body:JSON.stringify(body),
 headers:{'content-range':total?'0-'+(total-1)+'/'+total:'*/0'},
});

test('dashboard desktop mantém composição e mostra cartões apenas com dados da API',async({page})=>{
 await installSessionCookie(page,fakeSession());
 await page.route(/\/rest\/v1\/facts_dependents\?/,route=>json(route,[{
  id:'22222222-2222-4222-8222-222222222222',name:'Dependente Teste',
  birth_date:'2025-01-01',created_at:'2026-11-01T00:00:00Z',updated_at:'2026-11-01T00:00:00Z',
 }],1));
 await page.route(/\/rest\/v1\/facts_relationships\?/,route=>json(route,[]));
 await page.route(/\/rest\/v1\/facts_evidence\?/,route=>json(route,[]));
 await page.route(/\/rest\/v1\/facts\?/,route=>json(route,[]));
 await page.route(/\/rest\/v1\/facts_bank_transactions\?/,route=>{
  if(route.request().url().includes('tx_status=eq.PENDING'))return json(route,[]);
  return json(route,[{
   id:'00000000-0000-4000-8000-000000000001',occurred_at:'2026-11-03',
   amount_cents:120000,direction:'outgoing',tx_status:'POSTED',
   institution:'Instituição Teste',description:'Aluguel - teste',
   category:'Rent',foreign_charge:false,
  }],1);
 });
 await page.route(/\/functions\/v1\/bank-accounts/,route=>json(route,{
  source:'pluggy',fetchedAt:'2026-11-10T20:00:00Z',connections:1,accounts:[{
   id:'a658c848-e475-457b-8565-d1fffba127c4',
   institution:'Instituição Teste',type:'CREDIT',name:'Cartão Teste',
   marketingName:'Cartão Teste',subtype:'CREDIT_CARD',currency:'BRL',
   lastFour:'1234',balanceCents:49990,updatedAt:null,credit:{
    brand:'MASTERCARD',level:'BLACK',status:'ACTIVE',holderType:'MAIN',
    reportedBalanceCents:49990,creditLimitCents:100000,availableLimitCents:50010,
    dueDate:'2026-10-20',closingDate:'2026-11-05',
   },
  }],
 }));
 await page.goto('/');
 await expect(page.getByRole('heading',{name:'Saldo previsto'})).toBeVisible();
 await expect(page.getByRole('heading',{name:'Contas a pagar'})).toBeVisible();
 await expect(page.getByText('Nenhum vencimento confirmado para exibir.')).toBeVisible();
 await expect(page.getByRole('heading',{name:'Gastos da casa'})).toBeVisible();
 await expect(page.getByRole('heading',{name:'Cartões'})).toBeVisible();
 await expect(page.getByRole('heading',{name:'Moradia e custo de vida'})).toBeVisible();
 for(const name of ['wallet','calendar','balance','card','house']){
  const asset=page.locator(`img[src="/illustrations/${name}.svg"]`).first();
  await expect(asset).toBeVisible();
  await expect.poll(()=>asset.evaluate(img=>(img as HTMLImageElement).complete&&(img as HTMLImageElement).naturalWidth>0)).toBe(true);
 }
 await expect(page.getByText('Cartão Teste',{exact:true})).toBeVisible();
 await expect(page.getByText('•••• 1234')).toBeVisible();
 await expect(page.getByText('Aguardando saldos reais')).toBeVisible();
 await expect(page.getByText('Vencimento informado')).toBeVisible();
 await expect(page.getByText('Limite total')).toBeVisible();
 await expect(page.getByText('R$ 1.000,00',{exact:true})).toBeVisible();
 await expect(page.getByText(/Datas de vencimento podem ser de ciclos anteriores/)).toBeVisible();
 const title=page.getByRole('heading',{name:'Saldo previsto'});
 const bills=page.getByRole('heading',{name:'Contas a pagar'});
 const house=page.getByRole('heading',{name:'Gastos da casa'});
 const cards=page.getByRole('heading',{name:'Cartões'});
 const housing=page.getByRole('heading',{name:'Moradia e custo de vida'});
 const [a,b,c,d,e]=await Promise.all([title,bills,house,cards,housing].map(locator=>locator.boundingBox()));
 expect(a&&b&&c&&d&&e).toBeTruthy();
 expect(a!.x).toBeLessThan(b!.x);
 expect(c!.x).toBeLessThan(d!.x);
 expect(d!.x).toBeLessThan(e!.x);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth)).toBe(true);
 await expect(page.getByRole('button',{name:'Conversar com agente financeiro'})).toBeVisible();
 await page.getByRole('button',{name:'Conversar com agente financeiro'}).click();
 await expect(page.getByRole('dialog',{name:'Agente Facts'})).toBeVisible();
 await expect(page.getByText(/O computador está desligado ou a ponte Facts não foi iniciada/)).toBeVisible();
 await expect(page.getByRole('button',{name:'Enviar'})).toBeDisabled();
});
