export type BankTransferPurpose='pensao'|'adicional';
export type BankMatchSource='receiver'|'description';

export type BankFeedTransaction={
 id:string;
 itemId:string;
 accountId:string;
 amount:number;
 originalAmount:number|null;
 chargeDate:string;
 type:string|null;
 status:string|null;
 operationType:string|null;
 description:string;
 descriptionRaw:string|null;
 counterpartyName:string|null;
 counterpartyKind:'person'|'business'|null;
 paymentMethod:string|null;
};

export type RecipientRule={
 ownerId:string;
 dependentId:string;
 canonicalName:string;
 normalizedName:string;
 pensionAmountCents:number;
 pensionDayStart:number;
 pensionDayEnd:number;
 importFrom:string;
};

export function normalizeBankText(value:string):string{
 return value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim().replace(/\s+/g,' ');
}

export function moneyToCents(value:number):number|null{
 if(!Number.isFinite(value))return null;
 const cents=Math.round(Math.abs(value)*100);
 return Number.isSafeInteger(cents)&&cents>0?cents:null;
}

export function signedMoneyToCents(value:number|null):number|null{
 if(value===null||!Number.isFinite(value))return null;
 const cents=Math.round(value*100);
 return Number.isSafeInteger(cents)?cents:null;
}

export function matchRecipient(transaction:BankFeedTransaction,rule:RecipientRule):BankMatchSource|null{
 const target=rule.normalizedName||normalizeBankText(rule.canonicalName);
 if(!target)return null;
 if(transaction.counterpartyName&&normalizeBankText(transaction.counterpartyName).includes(target))return 'receiver';
 for(const value of [transaction.descriptionRaw,transaction.description]){
  if(value&&normalizeBankText(value).includes(target))return 'description';
 }
 return null;
}

export function classifyTransfer(amountCents:number,occurredAt:string,rule:RecipientRule):BankTransferPurpose{
 const day=Number(occurredAt.slice(8,10));
 return amountCents===rule.pensionAmountCents
  &&Number.isInteger(day)
  &&day>=rule.pensionDayStart
  &&day<=rule.pensionDayEnd
   ?'pensao'
   :'adicional';
}

export function overlapStart(importFrom:string,lastOccurredAt:string|null,overlapDays=14):string{
 if(!lastOccurredAt)return importFrom;
 const date=new Date(`${lastOccurredAt}T00:00:00.000Z`);
 if(Number.isNaN(date.getTime()))return importFrom;
 date.setUTCDate(date.getUTCDate()-overlapDays);
 const candidate=date.toISOString().slice(0,10);
 return candidate<importFrom?importFrom:candidate;
}
