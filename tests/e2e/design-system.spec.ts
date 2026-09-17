import {test,expect} from '@playwright/test';
import {fakeSession,installSessionCookie} from './session-cookie';

test('autenticação usa primitives shadcn do design system Facts',async({page})=>{
 await page.goto('/');
 await expect(page.locator('[data-slot="card"]').filter({hasText:'Seu histórico começa aqui.'})).toBeVisible();
 await expect(page.getByRole('button',{name:'Entrar no Facts',exact:true})).toHaveAttribute('data-slot','button');
});

test.describe('workspace desktop',()=>{
 test.use({viewport:{width:1280,height:900},isMobile:false,hasTouch:false});
 test('usa Sidebar shadcn como navegação principal',async({page})=>{
  await installSessionCookie(page,fakeSession());
  await page.goto('/');
  await expect(page.locator('[data-slot="sidebar-wrapper"]')).toBeVisible();
  await expect(page.locator('[data-slot="sidebar"]')).toBeVisible();
  await expect(page.getByRole('button',{name:/Registrar|Novo registro/i})).toHaveCount(0);
 });
});
