import type {BankFeedTransaction} from './automation';

type PluggyRawTransaction={
 id:string;accountId?:string;amount:number;amountInAccountCurrency?:number|null;
 date:string;type?:string|null;status?:string|null;description?:string|null;
 descriptionRaw?:string|null;category?:string|null;operationType?:string|null;
 currencyCode?:string|null;
 merchant?:{name?:string|null;businessName?:string|null}|null;
 paymentData?:{receiver?:{name?:string|null;documentNumber?:{type?:string|null}|null}|null;
 payer?:{name?:string|null;documentNumber?:{type?:string|null}|null}|null;paymentMethod?:string|null}|null;
};
export function mapPluggyTransaction(
 raw:PluggyRawTransaction,itemId:string,accountId:string,institution:string|null,
):BankFeedTransaction{
 if(!raw||typeof raw.id!=='string'||raw.id.length<1||!Number.isFinite(raw.amount)
  ||typeof raw.date!=='string'||!/^\d{4}-\d{2}-\d{2}/.test(raw.date))
  throw Error('PLUGGY_TRANSACTION_INVALID');
 const direction=raw.type?.toUpperCase();
 const participant=direction==='CREDIT'?(raw.paymentData?.payer??null):(raw.paymentData?.receiver??null);
 const kind=participant?.documentNumber?.type==='CPF'?'person':
  participant?.documentNumber?.type==='CNPJ'?'business':null;
 const isForeign=Boolean(raw.currencyCode&&raw.currencyCode!=='BRL');
 return{
  id:raw.id,itemId,accountId:raw.accountId||accountId,
  amount:typeof raw.amountInAccountCurrency==='number'&&isForeign?raw.amountInAccountCurrency:raw.amount,
  originalAmount:raw.amount,chargeDate:raw.date.slice(0,10),
  type:raw.type??null,status:raw.status??null,category:raw.category??null,
  operationType:raw.operationType??null,description:raw.description??'',
  descriptionRaw:raw.descriptionRaw??null,
  merchantName:raw.merchant?.name??raw.merchant?.businessName??null,
  counterpartyName:participant?.name??null,counterpartyKind:kind,
  paymentMethod:raw.paymentData?.paymentMethod??null,
  foreignCharge:isForeign,institution,
 };
}
