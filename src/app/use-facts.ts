import {useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {liveQuery} from 'dexie';
import {FactsCache,type FactsCacheState} from '../db/cache';
import {createSupabaseFactsService} from '../db/relational';
import {createSupabaseDocumentsService} from '../db/documents';
import {supabase} from '../lib/supabase/client';
import {errorMessage} from '../domain/view';

export function useFacts(userId:string){
 const cache=useMemo(()=>new FactsCache(userId),[userId]);
 const factsService=useMemo(()=>createSupabaseFactsService(supabase),[]),documentsService=useMemo(()=>createSupabaseDocumentsService(supabase),[]);
 const [state,setState]=useState<FactsCacheState>(),[error,setError]=useState(''),[loading,setLoading]=useState(true),[refreshing,setRefreshing]=useState(false),[online,setOnline]=useState(navigator.onLine),running=useRef(false);
 const refresh=useCallback(async()=>{
  if(!navigator.onLine||running.current)return;
  running.current=true;setRefreshing(true);
  try{
   const [dependents,facts,relationships,documents]=await Promise.all([factsService.listDependents(),factsService.listFacts(),factsService.listRelationships(),documentsService.listDocuments()]);
   await cache.write({dependent:dependents[0]??null,facts,relationships,documents});
   setError('');
  }catch(e){setError(errorMessage(e));}
  finally{running.current=false;setRefreshing(false);setLoading(false);}
 },[cache,documentsService,factsService]);
 useEffect(()=>{
  const sub=liveQuery(()=>cache.read()).subscribe({next:value=>{if(value)setState(value);},error:e=>setError(errorMessage(e))});
  void cache.read().then(value=>{if(value)setState(value);if(!navigator.onLine)setLoading(false);});
  const connected=()=>{setOnline(navigator.onLine);if(navigator.onLine)void refresh();};
  const visible=()=>{if(document.visibilityState==='visible'&&navigator.onLine)void refresh();};
  const focused=()=>{if(navigator.onLine)void refresh();};
  window.addEventListener('online',connected);window.addEventListener('offline',connected);window.addEventListener('focus',focused);document.addEventListener('visibilitychange',visible);
  const interval=window.setInterval(()=>{if(document.visibilityState==='visible'&&navigator.onLine)void refresh();},30000);
  if(navigator.onLine)void refresh();else setLoading(false);
  return()=>{sub.unsubscribe();window.clearInterval(interval);window.removeEventListener('online',connected);window.removeEventListener('offline',connected);window.removeEventListener('focus',focused);document.removeEventListener('visibilitychange',visible);cache.close();};
 },[cache,refresh]);
 return {state,error,loading,refreshing,online,refresh,documentsService};
}
