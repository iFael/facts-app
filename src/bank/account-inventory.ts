/** Public, allowlisted account data obtained from an authorized Pluggy connection. */
export type AccountInventory = {
  id:string;
  institution:string;
  type:'BANK'|'CREDIT';
  name:string;
  marketingName:string|null;
  subtype:string|null;
  currency:string;
  lastFour:string|null;
  balanceCents:number|null;
  updatedAt:string|null;
  credit: null | {
    brand:string|null;
    level:string|null;
    status:string|null;
    holderType:string|null;
    reportedBalanceCents:number|null;
    creditLimitCents:number|null;
    availableLimitCents:number|null;
    dueDate:string|null;
    closingDate:string|null;
  };
};
type Raw = Record<string,unknown>;
function record(value:unknown):Raw|null{
  return value!==null&&typeof value==='object'&&!Array.isArray(value)?value as Raw:null;
}
function value(value:unknown,max=100):string|null{
  if(typeof value!=='string')return null;
  const text=value.trim();
  if(!text||text.length>max||/[\u0000-\u001f]/.test(text))return null;
  return text;
}
function cents(value:unknown):number|null{
  if(typeof value!=='number'||!Number.isFinite(value)||Math.abs(value)>1e10)return null;
  const amount=Math.round(value*100);
  return Number.isSafeInteger(amount)?amount:null;
}
function date(value:unknown):string|null {
  const text=value?.toString();
  if(!text||! /^\d{4}-\d{2}-\d{2}$/.test(text.slice(0,10)))return null;
  const d=new Date(text.slice(0,10)+'T00:00:00Z');
  return !Number.isNaN(d.getTime())&&d.toISOString().slice(0,10)===text.slice(0,10)?text.slice(0,10):null;
}
function lastFour(value:unknown):string|null{
  const digits=typeof value==='string'?value.replace(/\D/g,''):'';
  return digits.length===4&&/^(?:[xX*#.\s]*\d{4})$/.test(String(value))
    ?digits:null;
}
export function mapPluggyAccount(
  raw:unknown,institutionName:string,
):AccountInventory{
  const account=record(raw);
  const type=account?.type;
  if(!account||typeof account.id!=='string'||!/^[a-f0-9-]{36}$/i.test(account.id)||
    !['BANK','CREDIT'].includes(String(type)))throw new Error('PLUGGY_ACCOUNT_INVALID');
  const name=value(account.name)??(type==='CREDIT'?'Cartão de crédito':'Conta bancária');
  const creditData=record(account.creditData);
  const currency=value(account.currencyCode,3)??'UNKNOWN';
  const bill=cents(account.balance);
  return {
    id:account.id,
    institution:value(institutionName)??'Instituição não informada',
    type:type as 'BANK'|'CREDIT',
    name,
    marketingName:value(account.marketingName),
    subtype:value(account.subtype),
    currency,
    lastFour:type==='CREDIT'?lastFour(account.number):null,
    balanceCents:bill,
    updatedAt:typeof account.updatedAt==='string'&&!Number.isNaN(Date.parse(account.updatedAt))
      ?new Date(account.updatedAt).toISOString():null,
    credit:type==='CREDIT'?{
      brand:value(creditData?.brand,30),
      level:value(creditData?.level,30),
      status:value(creditData?.status,25),
      holderType:value(creditData?.holderType,25),
      reportedBalanceCents:bill,
      creditLimitCents:cents(creditData?.creditLimit),
      availableLimitCents:cents(creditData?.availableCreditLimit),
      dueDate:date(creditData?.balanceDueDate),
      closingDate:date(creditData?.balanceCloseDate),
    }:null,
  };
}
/** Cards are styled only from bank/model data explicitly returned, never guessed. */
export function cardAppearance(account:AccountInventory):{
  label:string;issuer:string;theme:'orange'|'violet'|'navy'|'neutral';
} {
  if(account.type!=='CREDIT')throw new Error('NOT_A_CREDIT_CARD');
  const institution=account.institution;
  const marker=institution.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
  const theme=marker.includes('itau')?'orange':marker.includes('nubank')?'violet':
    marker.includes('mercado pago')?'navy':'neutral';
  return {label:account.marketingName??account.name,issuer:institution,theme};
}
