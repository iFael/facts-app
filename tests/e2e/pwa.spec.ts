import {test,expect} from '@playwright/test';

test('instala PWA e mantém a tela inicial disponível offline',async({page,context,request})=>{
 const manifest=await request.get('/manifest.webmanifest');
 expect(manifest.ok()).toBe(true);
 expect(await manifest.json()).toMatchObject({name:'Facts App',short_name:'Facts',display:'standalone'});

 await page.goto('/');
 await expect(page.getByLabel('E-mail',{exact:true})).toBeVisible();
 const state=await page.evaluate(async()=>{
  const registration=await navigator.serviceWorker.ready;
  const worker=registration.active;
  if(!worker)return null;
  if(worker.state!=='activated')await new Promise<void>((resolve,reject)=>{
   const timeout=setTimeout(()=>reject(new Error('Service worker não ativou a tempo.')),10000);
   worker.addEventListener('statechange',()=>{
    if(worker.state==='activated'){clearTimeout(timeout);resolve();}
   });
  });
  return worker.state;
 });
 expect(state).toBe('activated');
 await expect.poll(()=>page.evaluate(async()=>{
  const urls=[...new Set(performance.getEntriesByType('resource').map(entry=>entry.name).filter(name=>new URL(name).origin===location.origin&&new URL(name).pathname.startsWith('/_next/static/')))];
  if(!urls.length)return false;
  const cacheName=(await caches.keys()).find(name=>name.startsWith('facts-next-')&&name.endsWith('-app'));
  if(!cacheName)return false;
  const cache=await caches.open(cacheName);
  const matches=await Promise.all(urls.map(url=>cache.match(url)));
  return matches.every(Boolean);
 }),{timeout:10000}).toBe(true);

 const cdp=await context.newCDPSession(page);
 await cdp.send('Network.clearBrowserCache');
 await context.setOffline(true);
 await page.reload();
 await expect(page.getByLabel('E-mail',{exact:true})).toBeVisible();
 await context.setOffline(false);
});
