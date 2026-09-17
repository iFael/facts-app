import {writeFile} from 'node:fs/promises';

const version=`facts-next-${Date.now().toString(36)}`;
const appShell=['/','/manifest.webmanifest','/icon.svg','/icon-192.png','/icon-512.png','/apple-touch-icon.png'];
const source=`const VERSION=${JSON.stringify(version)};
const APP_CACHE=\`\${VERSION}-app\`;
const APP_SHELL=${JSON.stringify(appShell)};

self.addEventListener('install',event=>{
 event.waitUntil(caches.open(APP_CACHE).then(cache=>cache.addAll(APP_SHELL)));
});

self.addEventListener('activate',event=>{
 event.waitUntil(Promise.all([
  caches.keys().then(keys=>Promise.all(keys.filter(key=>(key.startsWith('facts-next-')&&key!==APP_CACHE)||key==='facts-ocr-v1').map(key=>caches.delete(key)))),
  self.clients.claim()
 ]));
});

self.addEventListener('message',event=>{
 if(event.data?.type==='SKIP_WAITING')void self.skipWaiting();
});

async function cacheFirst(request,cacheName){
 const cache=await caches.open(cacheName);
 const cached=await cache.match(request);
 if(cached)return cached;
 const response=await fetch(request);
 if(response.ok)await cache.put(request,response.clone());
 return response;
}

self.addEventListener('fetch',event=>{
 const request=event.request;
 if(request.method!=='GET')return;
 const url=new URL(request.url);
 if(url.origin!==self.location.origin)return;
 if(url.pathname.startsWith('/_next/static/')){
  event.respondWith(cacheFirst(request,APP_CACHE));
  return;
 }
 if(request.mode==='navigate'){
  event.respondWith((async()=>{
   const cache=await caches.open(APP_CACHE);
   try{
    const response=await fetch(request);
    if(response.ok)await cache.put(request,response.clone());
    return response;
   }catch{
    return (await cache.match(request))??(await cache.match('/'))??Response.error();
   }
  })());
 }
});
`;

await writeFile(new URL('../public/sw.js',import.meta.url),source,'utf8');
console.log('Service worker do Facts gerado.');
