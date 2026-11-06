import { categories, type Fact } from '../domain/core';

export type MonthlyBankInsight = {
  category: keyof typeof categories;
  label: string;
  previousCents: number;
  currentCents: number;
  increaseCents: number;
  increasePercent: number;
};
export type FinancialMonth = {
  month: string;
  expensesCents: number;
  transfersCents: number;
  totalCents: number;
};
function monthOffset(reference: string, offset: number): string {
  const date = new Date(reference.slice(0,7) + '-01T12:00:00.000Z');
  date.setUTCMonth(date.getUTCMonth() + offset);
  return date.toISOString().slice(0,7);
}
function monthDay(date: string): number { return Number(date.slice(8,10)); }
function categorySum(facts: readonly Fact[], month: string, upToDay: number | null) {
  const sums = new Map<keyof typeof categories, number>();
  for (const fact of facts) {
    if (fact.kind !== 'expense' && fact.kind !== 'payment') continue;
    if (!fact.occurredAt.startsWith(month)) continue;
    if (upToDay !== null && monthDay(fact.occurredAt) > upToDay) continue;
    sums.set(fact.category,(sums.get(fact.category) ?? 0) + fact.amountCents);
  }
  return sums;
}

/** Compare equivalent days, never count a partial month as a completed month. */
export function calculateFinancialInsights(facts: readonly Fact[], today: string) {
  const currentMonth = today.slice(0,7);
  const previousMonth = monthOffset(today,-1);
  const currentDay = monthDay(today);
  const current = categorySum(facts,currentMonth,currentDay);
  const previous = categorySum(facts,previousMonth,currentDay);
  const alerts:MonthlyBankInsight[] = [];
  for (const [category,amount] of current) {
    const base = previous.get(category) ?? 0;
    const increase = amount - base;
    if (base < 5000 || increase < 5000 || increase / base < 0.3) continue;
    alerts.push({
      category,label:categories[category],previousCents:base,currentCents:amount,
      increaseCents:increase,increasePercent:Math.round((increase / base) * 100),
    });
  }
  alerts.sort((a,b)=>b.increaseCents-a.increaseCents);
  const months:FinancialMonth[] = Array.from({length:6},(_,index)=>{
    const month=monthOffset(today,index-5);
    let expenses=0,transfers=0;
    for(const fact of facts){
      if(!fact.occurredAt.startsWith(month))continue;
      if(fact.kind==='expense'||fact.kind==='payment')expenses+=fact.amountCents;
      if(fact.kind==='transfer')transfers+=fact.amountCents;
    }
    return {month,expensesCents:expenses,transfersCents:transfers,totalCents:expenses+transfers};
  });
  return {
    alerts,
    months,
    currentExpensesCents:[...current.values()].reduce((sum,n)=>sum+n,0),
    previousExpensesCents:[...previous.values()].reduce((sum,n)=>sum+n,0),
  };
}
