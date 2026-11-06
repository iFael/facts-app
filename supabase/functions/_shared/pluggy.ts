/** Server-only Pluggy client owned entirely by Facts App. Never send API keys to the browser. */
const API='https://api.pluggy.ai';
type JsonRecord=Record<string,unknown>;
function record(value:unknown):JsonRecord{
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('PLUGGY_INVALID_RESPONSE');
 return value as JsonRecord;
}
function stringValue(value:unknown):string|null{return typeof value==='string'&&value.length?value:null;}
let keyCache:{signature:string;key:string;expiresAt:number}|null=null;

export class FactsPluggyClient{
 constructor(private clientId:string,private clientSecret:string){
  if(!clientId||!clientSecret)throw Error('PLUGGY_CONFIGURATION_REQUIRED');
 }
 private async apiKey():Promise<string>{
  const signature=this.clientId+':'+this.clientSecret;
  if(keyCache?.signature===signature&&Date.now()<keyCache.expiresAt)return keyCache.key;
  const res=await fetch(API+'/auth',{method:'POST',headers:{'Content-Type':'application/json'},
   body:JSON.stringify({clientId:this.clientId,clientSecret:this.clientSecret}),
   signal:AbortSignal.timeout(15000)});
  if(!res.ok)throw Error('PLUGGY_AUTH_'+res.status);
  const json=record(await res.json());
  const apiKey=stringValue(json.apiKey);
  if(!apiKey)throw Error('PLUGGY_AUTH_RESPONSE_INVALID');
  keyCache={signature,key:apiKey,expiresAt:Date.now()+110*60*1000};
  return apiKey;
 }
 private async request(method:'GET'|'POST',path:string,body?:JsonRecord,secondTry=false):Promise<JsonRecord>{
  if(!path.startsWith('/')||path.startsWith('//'))throw Error('PLUGGY_INVALID_PATH');
  const key=await this.apiKey();
  const res=await fetch(API+path,{method,headers:{
   'X-API-KEY':key,'Content-Type':'application/json',
  },body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(25000)});
  if(res.status===401&&!secondTry){
   keyCache=null;
   return this.request(method,path,body,true);
  }
  if(!res.ok)throw Error('PLUGGY_API_'+res.status);
  return record(await res.json());
 }
 async item(itemId:string):Promise<JsonRecord>{
  if(!/^[0-9a-f-]{36}$/i.test(itemId))throw Error('PLUGGY_ITEM_INVALID');
  return this.request('GET','/items/'+encodeURIComponent(itemId));
 }
 async accounts(itemId:string):Promise<Array<{id:string;type:string;name:string|null}>>{
  const rows:Array<{id:string;type:string;name:string|null}>=[];
  for(let page=1;page<=50;page++){
   const qs=new URLSearchParams({itemId,page:String(page),pageSize:'500'});
   const data=await this.request('GET','/accounts?'+qs);
   if(!Array.isArray(data.results))throw Error('PLUGGY_ACCOUNTS_INVALID');
   for(const item of data.results){
    const row=record(item),id=stringValue(row.id),type=stringValue(row.type);
    if(!id||!type)throw Error('PLUGGY_ACCOUNT_INVALID');
    rows.push({id,type,name:stringValue(row.marketingName)||stringValue(row.name)});
   }
   if(typeof data.totalPages!=='number'||page>=data.totalPages)return rows;
  }
  throw Error('PLUGGY_ACCOUNTS_PAGE_LIMIT');
 }
 async *transactions(accountId:string,from:string):AsyncGenerator<JsonRecord>{
  const search=new URLSearchParams({accountId,dateFrom:from});
  let path='/v2/transactions?'+search.toString();
  const visited=new Set<string>();
  for(let page=0;page<300;page++){
   if(visited.has(path))throw Error('PLUGGY_CURSOR_REPEAT');
   visited.add(path);
   const data=await this.request('GET',path);
   if(!Array.isArray(data.results))throw Error('PLUGGY_TRANSACTIONS_INVALID');
   for(const item of data.results)yield record(item);
   const next=data.next;
   if(next===null)return;
   if(typeof next!=='string'||!next.startsWith('?'))throw Error('PLUGGY_CURSOR_INVALID');
   const query=new URLSearchParams(next.slice(1));
   if(query.get('accountId')!==accountId)throw Error('PLUGGY_CURSOR_ACCOUNT_MISMATCH');
   path='/v2/transactions'+next;
  }
  throw Error('PLUGGY_CURSOR_PAGE_LIMIT');
 }
 async connectToken(ownerId:string):Promise<string>{
  const data=await this.request('POST','/connect_token',{
   options:{clientUserId:ownerId,avoidDuplicates:true},
  });
  const token=stringValue(data.accessToken);
  if(!token)throw Error('PLUGGY_CONNECT_TOKEN_INVALID');
  return token;
 }
 async ensureWebhook(url:string,secret:string):Promise<void>{
  const list=await this.request('GET','/webhooks');
  if(!Array.isArray(list.results))throw Error('PLUGGY_WEBHOOK_LIST_INVALID');
  if(list.results.some(item=>{
   const row=record(item);
   return row.url===url&&row.event==='all'&&row.disabledAt==null;
  }))return;
  await this.request('POST','/webhooks',{
   url,event:'all',headers:{'X-Facts-Webhook-Secret':secret},
  });
 }
}
