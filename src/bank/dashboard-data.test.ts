import {describe,it,expect} from 'vitest';
import {summarizeFinancialDashboard,type FinancialBankRow} from './dashboard-data';

const base:FinancialBankRow={
  id:'a',occurred_at:'2026-11-05',amount_cents:120000,
  direction:'outgoing',tx_status:'POSTED',institution:'Mercado Pago',
  description:null,category:'Rent',foreign_charge:false,
};
describe('Financial dashboard classification',()=>{
  it('includes only explicit housing categories for the selected month',()=>{
    const result=summarizeFinancialDashboard([
      base,
      {...base,id:'b',category:'Condominium',amount_cents:50000},
      {...base,id:'c',category:'Clothing',amount_cents:70000},
      {...base,id:'d',category:'Same person transfer',amount_cents:90000},
    ],'2026-11');
    expect(result.housingCents).toBe(170000);
    expect(result.housing.map(x=>x.label)).toEqual(['Aluguel','Condomínio']);
    expect(result.outgoingCents).toBe(330000);
  });
  it('excludes pending, foreign, wrong month and nonpositive entries',()=>{
    const result=summarizeFinancialDashboard([
      base,{...base,id:'b',tx_status:'PENDING'},
      {...base,id:'c',foreign_charge:true},
      {...base,id:'d',occurred_at:'2026-10-30'},
      {...base,id:'e',amount_cents:0},
    ],'2026-11');
    expect(result.postedCount).toBe(1);
  });
  it('does not count incoming transfers as housing expenses',()=>{
    const result=summarizeFinancialDashboard([
      {...base,direction:'incoming'},
    ],'2026-11');
    expect(result.housingCents).toBe(0);
    expect(result.incomingCents).toBe(120000);
  });
  it('rejects invalid month',()=>{
    expect(()=>summarizeFinancialDashboard([],'2026-13')).toThrow('INVALID_MONTH');
  });
});
