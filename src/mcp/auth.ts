export interface FactsJwtClaims{
 sub?:string;
 client_id?:string;
 scope?:string;
 exp?:number;
 [key:string]:unknown;
}

export function buildProtectedResourceMetadata(resource:string,authorizationServer:string){
 return {
  resource,
  authorization_servers:[authorizationServer],
  scopes_supported:['openid','profile','email','offline_access'],
  bearer_methods_supported:['header'],
  resource_name:'Facts MCP'
 };
}

export function buildUnauthorizedHeaders(resourceMetadataUrl:string):Headers{
 const headers=new Headers({'Content-Type':'application/json'});
 headers.set('WWW-Authenticate',`Bearer resource_metadata="${resourceMetadataUrl}"`);
 return headers;
}

export function readJwtClaims(token:string):FactsJwtClaims{
 try{
  const parts=token.split('.');
  if(parts.length!==3)return {};
  const normalized=parts[1].replaceAll('-','+').replaceAll('_','/');
  const padded=normalized+'='.repeat((4-normalized.length%4)%4);
  const decoded=atob(padded);
  const bytes=Uint8Array.from(decoded,char=>char.charCodeAt(0));
  const value=JSON.parse(new TextDecoder().decode(bytes));
  return value&&typeof value==='object'?value as FactsJwtClaims:{};
 }catch{return {};}
}
