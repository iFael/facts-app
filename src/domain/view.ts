import {categories,type Fact,type FactRelationship} from './core';

export {categories};
export const kinds={expense:'Despesa',payment:'Pagamento',transfer:'Transferência',request:'Solicitação',event:'Acontecimento'} as const;
export const money=(c:number)=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(c/100);
export const moneyInput=(c:number)=>String(Math.floor(c/100))+','+String(c%100).padStart(2,'0');
export const today=()=>{const d=new Date();return [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-');};
export const dateLabel=(d:string)=>d.split('-').reverse().join('/');
export function parseMoney(input:string):number{
 let s=input.trim().replace(/^R\$\s*/,'');
 if(/^\d+\.\d{1,2}$/.test(s))s=s.replace('.',',');
 if(!/^(?:\d+|\d{1,3}(?:\.\d{3})+)(?:,\d{1,2})?$/.test(s))throw new Error('Valor inválido. Use 123,45.');
 const [whole,part='']=s.replaceAll('.','').split(','),result=Number(whole)*100+Number(part.padEnd(2,'0'));
 if(!Number.isSafeInteger(result)||result<=0||result>99999999999)throw new Error('Informe um valor positivo dentro do limite.');
 return result;
}
export function errorMessage(e:unknown):string{
 if(e instanceof Error)return e.message;
 if(e&&typeof e==='object'&&'message' in e)return String(e.message);
 return 'Não foi possível concluir a operação.';
}
export function amountOf(fact:Fact):number{return fact.kind==='event'?0:fact.amountCents;}
export function requestPaid(id:string,facts:readonly Fact[],relationships:readonly FactRelationship[]):number{
 const ids=new Set(relationships.filter(link=>link.requestId===id).map(link=>link.factId));
 return facts.filter(fact=>ids.has(fact.id)&&['expense','payment','transfer'].includes(fact.kind)).reduce((sum,fact)=>sum+amountOf(fact),0);
}
export function summarize(facts:readonly Fact[],relationships:readonly FactRelationship[],month:string){
 const rows=facts.filter(f=>!month||f.occurredAt.slice(0,7)<=month);
 const expenses=rows.filter(f=>f.kind==='expense'||f.kind==='payment').reduce((s,f)=>s+amountOf(f),0);
 const transfers=rows.filter(f=>f.kind==='transfer').reduce((s,f)=>s+amountOf(f),0);
 const pending=facts.filter(f=>f.kind==='request'&&requestPaid(f.id,facts,relationships)<f.amountCents).length;
 return {expenses,transfers,total:expenses+transfers,pending};
}
