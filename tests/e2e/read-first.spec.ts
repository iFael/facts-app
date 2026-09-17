import {test,expect,type Page} from '@playwright/test';
import {fakeSession,installSessionCookie} from './session-cookie';

const userId='55555555-5555-4555-8555-555555555555';

async function openWorkspace(page:Page,width:number,height:number){
 await installSessionCookie(page,fakeSession(userId));
 await page.setViewportSize({width,height});
 await page.goto('/');
 await page.evaluate(async id=>{
  await new Promise<void>((resolve,reject)=>{
   const request=indexedDB.open(`facts-cache-v2-${id}`);
   request.onerror=()=>reject(request.error);
   request.onsuccess=()=>{const db=request.result,tx=db.transaction('state','readwrite'),now=new Date().toISOString();tx.objectStore('state').put({key:'main',dependent:{id:'22222222-2222-4222-8222-222222222222',name:'Dependente Teste',birthDate:'2025-01-01',createdAt:now,updatedAt:now},facts:[],relationships:[],documents:[],updatedAt:now});tx.oncomplete=()=>{db.close();resolve();};tx.onerror=()=>reject(tx.error);};
  });
 },userId);
 await page.reload();
 await expect(page.getByText('Dependente Teste',{exact:true}).last()).toBeVisible();
}

test('UI read-first separa Início, Extrato, Fatos, Documentos e Relatórios',async({page})=>{
 await openWorkspace(page,1280,900);
 const sidebar=page.locator('[data-slot="sidebar"]');
 for(const label of ['Início','Extrato','Fatos','Solicitações','Documentos','Relatórios'])await expect(sidebar.getByRole('button',{name:label,exact:true}).last()).toBeVisible();
 await expect(page.getByLabel('Mês dos registros')).toBeVisible();
 await sidebar.getByRole('button',{name:'Extrato',exact:true}).last().click();
 await expect(page.getByRole('heading',{name:'Extrato',exact:true})).toBeVisible();
 await expect(page.getByRole('heading',{name:'Movimentações',exact:true})).toBeVisible();
 await expect(page.getByLabel('Mês dos registros')).toBeVisible();
 await expect(page.getByLabel('Filtrar tipo')).toHaveCount(0);
 await sidebar.getByRole('button',{name:'Fatos',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Fatos',exact:true})).toBeVisible();
 await expect(page.getByLabel('Filtrar tipo')).toBeVisible();
 await expect(page.getByLabel('Filtrar categoria')).toBeVisible();
 await sidebar.getByRole('button',{name:'Documentos',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Documentos',exact:true})).toBeVisible();
 await expect(page.getByText('Nenhum documento.',{exact:true})).toBeVisible();
 await sidebar.getByRole('button',{name:'Relatórios',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Relatórios',exact:true})).toBeVisible();
 await expect(page.getByText('Sem dados para analisar.',{exact:true})).toBeVisible();
});

test('mobile concentra áreas secundárias em Mais',async({page})=>{
 await openWorkspace(page,390,844);
 await expect(page.getByRole('button',{name:'Início',exact:true}).last()).toBeVisible();
 await expect(page.getByRole('button',{name:'Extrato',exact:true}).last()).toBeVisible();
 await expect(page.getByRole('button',{name:'Fatos',exact:true}).last()).toBeVisible();
 await page.getByRole('button',{name:'Mais',exact:true}).click();
 for(const label of ['Solicitações','Documentos','Relatórios','Meus dados'])await expect(page.getByRole('button',{name:label,exact:true}).last()).toBeVisible();
});
