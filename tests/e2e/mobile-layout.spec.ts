import {test,expect,type Page} from '@playwright/test';
import {fakeSession,installSessionCookie} from './session-cookie';

const userId='77777777-7777-4777-8777-777777777777';
const stamp='2026-09-04T12:00:00.000Z';

async function seedWorkspace(page:Page,width:number){
 await installSessionCookie(page,fakeSession(userId));
 await page.setViewportSize({width,height:844});
 await page.goto('/');
 await page.evaluate(async({id,now})=>{
  await new Promise<void>((resolve,reject)=>{
   const request=indexedDB.open(`facts-cache-v2-${id}`);
   request.onerror=()=>reject(request.error);
   request.onsuccess=()=>{
    const db=request.result,tx=db.transaction('state','readwrite');
    tx.objectStore('state').put({
     key:'main',
     dependent:{id:'22222222-2222-4222-8222-222222222222',name:'Dependente Teste',birthDate:'2025-01-01',createdAt:now,updatedAt:now},
     facts:[
      {id:'11111111-1111-4111-8111-111111111111',dependentId:'22222222-2222-4222-8222-222222222222',kind:'transfer',title:'Transferência agosto',category:'pensao',notes:'',occurredAt:'2026-08-20',amountCents:123456,transferPurpose:'pensao',source:'chat',createdBy:'assistant',provenanceKind:'user_assertion',createdAt:now,updatedAt:now},
      {id:'33333333-3333-4333-8333-333333333333',dependentId:'22222222-2222-4222-8222-222222222222',kind:'transfer',title:'Transferência setembro',category:'pensao',notes:'',occurredAt:'2026-09-04',amountCents:123456,transferPurpose:'pensao',source:'chat',createdBy:'assistant',provenanceKind:'user_assertion',createdAt:now,updatedAt:now}
     ],
     relationships:[],documents:[],updatedAt:now
    });
    tx.oncomplete=()=>{db.close();resolve();};tx.onerror=()=>reject(tx.error);
   };
  });
 },{id:userId,now:stamp});
 await page.reload();
 await expect(page.getByRole('heading',{name:'Dependente Teste',exact:true})).toBeVisible();
}

for(const width of [375,390,430]){
 test(`layout mobile coerente em ${width}px`,async({page})=>{
  await seedWorkspace(page,width);
  const header=page.locator('header').first();
  const main=page.locator('main').last();
  const nav=page.locator('nav').first();
  const wrapper=page.locator('[data-slot="sidebar-wrapper"]');
  const month=page.getByLabel('Mês dos registros');
  const heading=page.getByRole('heading',{name:'Dependente Teste',exact:true});
  const cards=page.locator('section[aria-label="Resumo mensal"] [data-slot="card"]');

  expect(await header.getAttribute('class')).toContain('env(safe-area-inset-top)');
  expect(await nav.getAttribute('class')).toContain('env(safe-area-inset-bottom)');
  expect(await main.getAttribute('class')).toContain('env(safe-area-inset-bottom)');
  expect(await wrapper.getAttribute('class')).toContain('min-h-dvh');

  const headingBox=await heading.boundingBox(),monthBox=await month.boundingBox();
  expect(headingBox).not.toBeNull();expect(monthBox).not.toBeNull();
  expect(monthBox!.y-(headingBox!.y+headingBox!.height)).toBeLessThanOrEqual(20);

  for(const card of await cards.all()){
   const box=await card.boundingBox();
   expect(box).not.toBeNull();
   expect(box!.height).toBeLessThan(140);
  }

  const totalFont=await page.getByTestId('total').evaluate(el=>Number.parseFloat(getComputedStyle(el).fontSize));
  expect(totalFont).toBeLessThanOrEqual(width<=390?28:30);
  expect(await page.getByTestId('total').textContent()).toContain('2.469,12');
  expect(await page.getByTestId('transfers').textContent()).toContain('2.469,12');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth)).toBe(true);

  const navBox=await nav.boundingBox();
  expect(navBox).not.toBeNull();
  const paddingBottom=await main.evaluate(el=>Number.parseFloat(getComputedStyle(el).paddingBottom));
  expect(paddingBottom).toBeGreaterThanOrEqual(navBox!.height);
 });
}
