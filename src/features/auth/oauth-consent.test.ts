import {describe,expect,it} from 'vitest';
import {authorizationIdFromUrl,scopeLabels} from './oauth-consent';

describe('OAuth consent helpers',()=>{
 it('extrai authorization_id somente quando válido',()=>{
  expect(authorizationIdFromUrl('https://facts.app/?authorization_id=abc-123')).toBe('abc-123');
  expect(authorizationIdFromUrl('https://facts.app/')).toBeNull();
 });
 it('normaliza scopes sem duplicatas',()=>{
  expect(scopeLabels('openid  profile email profile')).toEqual(['openid','profile','email']);
 });
});
