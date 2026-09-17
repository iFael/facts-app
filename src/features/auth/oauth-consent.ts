export function authorizationIdFromUrl(url:string):string|null{
 try{
  const value=new URL(url).searchParams.get('authorization_id')?.trim();
  return value||null;
 }catch{return null;}
}

export function scopeLabels(scope:string):string[]{
 return [...new Set(scope.split(/\s+/).map(value=>value.trim()).filter(Boolean))];
}
