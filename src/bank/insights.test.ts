import {describe,expect,it} from 'vitest';
import {calculateFinancialInsights} from './insights';
import type {Fact} from '../domain/core';

const expense=(date:string,amountCents:number,category:'saude'|'higiene'='saude'):Fact=>({
  id:crypto.randomUUID(),dependentId:crypto.randomUUID(),
  title:'Despesa',category,notes:'',occurredAt:date,kind:'expense',
  amountCents,source:'chat',createdBy:'assistant',provenanceKind:'evidence_derived',
  createdAt:'2026-11-01T12:00:00Z',updatedAt:'2026-11-01T12:00:00Z',
});
describe('financial insights',()=>{
  it('compares equivalent days and detects material category increases',()=>{
    const facts=[
      expense('2026-10-03',10000),expense('2026-11-04',15000),
      expense('2026-11-15',90000),expense('2026-10-20',50000),
    ];
    const result=calculateFinancialInsights(facts,'2026-11-05');
    expect(result.currentExpensesCents).toBe(15000);
    expect(result.previousExpensesCents).toBe(10000);
    expect(result.alerts[0]).toMatchObject({category:'saude',increaseCents:5000,increasePercent:50});
  });
  it('does not invent an increase without a baseline or from small fluctuations',()=>{
    const facts=[expense('2026-11-04',60000,'higiene'),expense('2026-10-03',10000),expense('2026-11-04',11000)];
    const result=calculateFinancialInsights(facts,'2026-11-05');
    expect(result.alerts).toEqual([]);
  });
  it('retains six monthly totals without mistaking pension for a shopping category',()=>{
    const facts=[expense('2026-10-12',30000)];
    const result=calculateFinancialInsights(facts,'2026-11-05');
    expect(result.months).toHaveLength(6);
    expect(result.months.find(m=>m.month==='2026-10')?.totalCents).toBe(30000);
  });
});
