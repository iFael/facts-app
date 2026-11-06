import {describe,it,expect} from 'vitest';
import {mapPluggyTransaction} from './pluggy-mapper';

const base={
 id:'pluggy-tx',accountId:'account-1',amount:-800,date:'2026-11-05T14:00:00.000Z',
 description:'PIX enviado AGATA LUANA TAVARES DOS SANTOS',
 status:'POSTED',type:'DEBIT',currencyCode:'BRL',
 paymentData:{receiver:{name:'Agata Luana Tavares dos Santos',documentNumber:{type:'CPF'}},paymentMethod:'PIX'},
};
describe('independent Facts Pluggy mapping',()=>{
 it('maps outgoing transfers without fetching the Ciclo database',()=>{
  expect(mapPluggyTransaction(base,'item','account-1','Mercado Pago')).toMatchObject({
   id:'pluggy-tx',itemId:'item',amount:-800,type:'DEBIT',
   chargeDate:'2026-11-05',counterpartyName:'Agata Luana Tavares dos Santos',
   counterpartyKind:'person',foreignCharge:false,
  });
 });
 it('identifies payer on incoming transfers, not the receiver',()=>{
  const transfer=mapPluggyTransaction({...base,type:'CREDIT',
   paymentData:{payer:{name:'Agata',documentNumber:{type:'CPF'}},paymentMethod:'PIX'}},'item','account-1','Itaú');
  expect(transfer.counterpartyName).toBe('Agata');
 });
 it('keeps foreign currency marked as non-autobookable',()=>{
  expect(mapPluggyTransaction({...base,currencyCode:'USD',amount:-10,
   amountInAccountCurrency:-53},'item','account-1',null)).toMatchObject({
    foreignCharge:true,amount:-53,originalAmount:-10,
   });
 });
 it('rejects incomplete provider records instead of silently dropping them',()=>{
  expect(()=>mapPluggyTransaction({...base,date:'bad'},'item','account-1',null)).toThrow('PLUGGY_TRANSACTION_INVALID');
 });
});
