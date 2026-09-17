import {describe,expect,it} from 'vitest';
import {buildProtectedResourceMetadata,buildUnauthorizedHeaders,readJwtClaims} from './auth';

describe('Facts MCP auth helpers',()=>{
 it('publica RFC 9728 apontando para o Supabase Auth existente',()=>{
  expect(buildProtectedResourceMetadata('https://example.supabase.co/functions/v1/facts-mcp','https://example.supabase.co/auth/v1')).toEqual({
   resource:'https://example.supabase.co/functions/v1/facts-mcp',
   authorization_servers:['https://example.supabase.co/auth/v1'],
   scopes_supported:['openid','profile','email','offline_access'],
   bearer_methods_supported:['header'],
   resource_name:'Facts MCP'
  });
 });
 it('401 anuncia a URL explícita de metadata do recurso',()=>{
  const headers=buildUnauthorizedHeaders('https://example.supabase.co/functions/v1/facts-mcp/.well-known/oauth-protected-resource');
  expect(headers.get('WWW-Authenticate')).toContain('resource_metadata="https://example.supabase.co/functions/v1/facts-mcp/.well-known/oauth-protected-resource"');
 });
 it('lê claims JWT apenas como metadata depois da validação externa',()=>{
  const payload=btoa(JSON.stringify({sub:'user',client_id:'client',scope:'openid profile',exp:123})).replaceAll('=','').replaceAll('+','-').replaceAll('/','_');
  expect(readJwtClaims(`x.${payload}.y`)).toMatchObject({sub:'user',client_id:'client',scope:'openid profile',exp:123});
  expect(readJwtClaims('inválido')).toEqual({});
 });
});
