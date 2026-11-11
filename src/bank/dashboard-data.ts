export type FinancialBankRow={
  id:string;
  occurred_at:string;
  amount_cents:number;
  direction:string;
  tx_status:string;
  institution:string|null;
  description:string|null;
  category:string|null;
  foreign_charge:boolean|null;
};
export type HousingLine={label:string;amountCents:number;count:number};
const housingLabels:Record<string,string>={
  rent:'Aluguel',
  condominium:'Condomínio',
  electricity:'Energia',
  'electricity bills':'Energia',
  'water and sewage':'Água e esgoto',
  'water bills':'Água',
  'natural gas':'Gás',
  'home insurance':'Seguro residencial',
  'home maintenance':'Manutenção residencial',
  'property tax':'Impostos do imóvel',
};
export function summarizeFinancialDashboard(rows:readonly FinancialBankRow[],month:string){
  if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))throw new Error('INVALID_MONTH');
  const posted=rows.filter(row=>row.tx_status==='POSTED'&&row.foreign_charge!==true&&
    row.occurred_at.startsWith(month)&&Number.isSafeInteger(row.amount_cents)&&row.amount_cents>0);
  const housing=new Map<string,HousingLine>();
  const recent=[...posted].sort((a,b)=>b.occurred_at.localeCompare(a.occurred_at)).slice(0,7);
  let incomingCents=0,outgoingCents=0;
  for(const row of posted){
    if(row.direction==='incoming')incomingCents+=row.amount_cents;
    if(row.direction==='outgoing'){
      outgoingCents+=row.amount_cents;
      const label=housingLabels[(row.category??'').trim().toLowerCase()];
      if(label){
        const line=housing.get(label)??{label,amountCents:0,count:0};
        line.amountCents+=row.amount_cents;
        line.count++;
        housing.set(label,line);
      }
    }
  }
  return {
    incomingCents,outgoingCents,
    housing:[...housing.values()].sort((a,b)=>b.amountCents-a.amountCents),
    housingCents:[...housing.values()].reduce((sum,value)=>sum+value.amountCents,0),
    recent,postedCount:posted.length,
  };
}
