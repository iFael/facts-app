import {describe,expect,it} from 'vitest';
import {agentHeartbeatFresh,agentJobResult} from './remote-contract';

describe('remote agent availability',()=>{
 it('requires a recent timestamp from the same owner',()=>{
  const now=Date.parse('2026-11-11T01:00:00Z');
  expect(agentHeartbeatFresh('2026-11-11T00:59:50Z',now)).toBe(true);
  expect(agentHeartbeatFresh('2026-11-11T00:58:00Z',now)).toBe(false);
  expect(agentHeartbeatFresh('2026-11-11T01:02:00Z',now)).toBe(false);
  expect(agentHeartbeatFresh(null,now)).toBe(false);
 });
 it('accepts only bounded, valid replies',()=>{
  expect(agentJobResult({status:'done',reply:'Resumo',coverage:'partial'}))
   .toEqual({status:'done',reply:'Resumo',coverage:'partial'});
  expect(agentJobResult({status:'done',reply:''})).toBeNull();
  expect(agentJobResult({status:'done',reply:'x'.repeat(8001)})).toBeNull();
  expect(agentJobResult({status:'other',reply:'foo'})).toBeNull();
  expect(agentJobResult({status:'queued',reply:null})).toEqual({status:'queued',reply:null,coverage:null});
 });
});
