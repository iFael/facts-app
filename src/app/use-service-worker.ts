'use client';

import {useCallback,useEffect,useRef,useState} from 'react';

async function seedLoadedNextAssets(){
 if(!('caches' in window))return;
 const cacheName=(await caches.keys()).filter(name=>name.startsWith('facts-next-')&&name.endsWith('-app')).sort().at(-1);
 if(!cacheName)return;
 const urls=[...new Set(performance.getEntriesByType('resource').map(entry=>entry.name).filter(name=>{
  const url=new URL(name);
  return url.origin===location.origin&&url.pathname.startsWith('/_next/static/');
 }))];
 if(!urls.length)return;
 const cache=await caches.open(cacheName);
 await Promise.all(urls.map(async url=>{
  if(await cache.match(url))return;
  const response=await fetch(url,{cache:'force-cache'});
  if(!response.ok)throw new Error(`Falha ao preparar asset offline: ${new URL(url).pathname}`);
  await cache.put(url,response);
 }));
}

export function useServiceWorkerUpdate(){
 const [updateAvailable,setUpdateAvailable]=useState(false);
 const reloadRequested=useRef(false),reloading=useRef(false);
 useEffect(()=>{
  if(process.env.NODE_ENV!=='production'||!('serviceWorker' in navigator))return;
  let active=true,registration:ServiceWorkerRegistration|null=null;
  const inspect=(worker:ServiceWorker|null)=>{
   if(!worker)return;
   const check=()=>{
    if(active&&worker.state==='installed'&&navigator.serviceWorker.controller)setUpdateAvailable(true);
   };
   if(worker.state==='installed')check();
   else worker.addEventListener('statechange',check);
  };
  const checkForUpdate=async()=>{
   if(!active||!registration||!navigator.onLine||registration.waiting)return;
   try{await registration.update();}catch{}
  };
  const focus=()=>{void checkForUpdate();};
  const visibility=()=>{if(document.visibilityState==='visible')void checkForUpdate();};
  const controllerChange=()=>{
   if(!reloadRequested.current||reloading.current)return;
   reloading.current=true;
   window.location.reload();
  };
  window.addEventListener('focus',focus);
  document.addEventListener('visibilitychange',visibility);
  navigator.serviceWorker.addEventListener('controllerchange',controllerChange);
  const interval=window.setInterval(()=>void checkForUpdate(),60000);
  void navigator.serviceWorker.register('/sw.js',{updateViaCache:'none'}).then(async current=>{
   registration=current;
   if(!active)return;
   if(current.waiting&&navigator.serviceWorker.controller)setUpdateAvailable(true);
   inspect(current.installing);
   current.addEventListener('updatefound',()=>inspect(current.installing));
   await navigator.serviceWorker.ready;
   if(active){
    await seedLoadedNextAssets();
    void checkForUpdate();
   }
  }).catch(error=>console.error('Falha ao preparar PWA offline do Facts.',error));
  return()=>{
   active=false;
   window.clearInterval(interval);
   window.removeEventListener('focus',focus);
   document.removeEventListener('visibilitychange',visibility);
   navigator.serviceWorker.removeEventListener('controllerchange',controllerChange);
  };
 },[]);
 const applyUpdate=useCallback(async()=>{
  if(process.env.NODE_ENV!=='production'||!('serviceWorker' in navigator))return;
  const registration=await navigator.serviceWorker.getRegistration();
  if(!registration)return;
  if(!registration.waiting)await registration.update();
  if(registration.waiting){
   reloadRequested.current=true;
   registration.waiting.postMessage({type:'SKIP_WAITING'});
  }
 },[]);
 return {updateAvailable,applyUpdate};
}
