import {it,expect} from 'vitest';
import {factSchema,type Fact} from './core';
import {money,parseMoney,summarize} from './view';
const base={id:'11111111-1111-4111-8111-111111111111',dependentId:'22222222-2222-4222-8222-222222222222',kind:'expense',title:'Teste',category:'outros',notes:'',occurredAt:'2026-09-12',source:'ui',createdBy:'user',provenanceKind:'user_assertion',createdAt:'2026-09-12T12:00:00.000Z',updatedAt:'2026-09-12T12:00:00.000Z'} as const;
it('10,00 + 20,00 resulta em 30,00 e nunca concatena',()=>{const rows=[{...base,id:'11111111-1111-4111-8111-111111111111',amountCents:parseMoney('10,00')},{...base,id:'33333333-3333-4333-8333-333333333333',amountCents:parseMoney('20,00')}] as Fact[];const r=summarize(rows,[],'2026-09');expect(r.total).toBe(3000);expect(typeof r.total).toBe('number');expect(money(r.total)).toMatch(/30,00/);});
it('valor monetário string é rejeitado pelo Domain Core',()=>{expect(()=>factSchema.parse({...base,amountCents:'1000'})).toThrow();});
