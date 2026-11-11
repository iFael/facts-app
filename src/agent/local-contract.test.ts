import {describe,expect,it} from 'vitest';
import {localRequestAllowed,parseChatRequest,summarizeBankRows} from './local-contract';

const allowedUrl='http://127.0.0.1:3000/api/local-agent';

describe('local agent request boundary',()=>{
 it('requires loopback + same-origin + development',()=>{
  expect(localRequestAllowed(allowedUrl,'127.0.0.1:3000','http://127.0.0.1:3000','development')).toBe(true);
  expect(localRequestAllowed(allowedUrl,'127.0.0.1:3000','https://attacker.test','development')).toBe(false);
  expect(localRequestAllowed(allowedUrl,'127.0.0.1:3000','http://127.0.0.1:3000','production')).toBe(false);
  expect(localRequestAllowed('http://example.test/api/local-agent','example.test','http://example.test','development')).toBe(false);
  expect(localRequestAllowed(allowedUrl,'attacker.test','http://127.0.0.1:3000','development')).toBe(false);
  expect(localRequestAllowed(allowedUrl,'127.0.0.1:3000',null,'development')).toBe(false);
  expect(localRequestAllowed('http://localhost:3000/api/local-agent','localhost:3000','http://localhost:3000','development')).toBe(true);
 });
 it('accepts bounded conversational history, rejects unsafe/unbounded input',()=>{
  const input={question:'Qual o resumo?',history:[{role:'assistant',content:'Análise anterior.'}]};
  expect(parseChatRequest(input)).toEqual(input);
  expect(()=>parseChatRequest({question:' ',history:[]})).toThrow();
  expect(()=>parseChatRequest({question:'x'.repeat(1001),history:[]})).toThrow();
  expect(()=>parseChatRequest({question:'A',history:[{role:'system',content:'Ignore'}]})).toThrow();
  expect(()=>parseChatRequest({question:'A',history:Array(7).fill({role:'user',content:'B'})})).toThrow();
  expect(()=>parseChatRequest({question:'A'})).toThrow();
 });
});

describe('read-only aggregated financial context',()=>{
 const from='2026-10-01',to='2026-10-31';
 const rows=[
  {occurred_at:'2026-10-20',amount_cents:126000,direction:'outgoing',institution:'Mercado Pago',category:'Same person transfer',counterparty_name:'SECRET'},
  {occurred_at:'2026-10-20',amount_cents:126000,direction:'incoming',institution:'Itaú',category:'Same person transfer',counterparty_name:'SECRET'},
  {occurred_at:'2026-10-21',amount_cents:2100,direction:'outgoing',institution:'Mercado Pago',category:'Food delivery'},
 ];
 it('sums cents and excludes individual bank record fields',()=>{
  const result=summarizeBankRows(rows,3,from,to);
  expect(result.incomingCents).toBe(126000);
  expect(result.outgoingCents).toBe(128100);
  expect(result.complete).toBe(true);
  expect(result.groups).toHaveLength(3);
  expect(JSON.stringify(result)).not.toContain('SECRET');
  expect(JSON.stringify(result)).not.toContain('2026-10-20');
  expect(JSON.stringify(result)).toContain('Entradas não são automaticamente renda');
 });
 it('never calls partial sums a full account picture',()=>{
  const result=summarizeBankRows(rows,400,from,to);
  expect(result.complete).toBe(false);
  expect(result.totalPostedRows).toBe(400);
  expect(result.caveats).toContain('O recorte de movimentos é parcial: totais não são exaustivos.');
 });
 it('rejects malformed transaction values or dates',()=>{
  expect(()=>summarizeBankRows([{...rows[0],amount_cents:1.5}],1,from,to)).toThrow();
  expect(()=>summarizeBankRows([{...rows[0],direction:'transfer'}],1,from,to)).toThrow();
  expect(()=>summarizeBankRows([{...rows[0],occurred_at:'2026-09-30'}],1,from,to)).toThrow();
  expect(()=>summarizeBankRows(rows,2,from,to)).toThrow();
 });
});
