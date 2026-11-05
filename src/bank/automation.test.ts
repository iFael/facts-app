import {describe,expect,it} from 'vitest';
import {classifyTransfer,matchRecipient,moneyToCents,normalizeBankText,overlapStart,type BankFeedTransaction,type RecipientRule} from './automation';

const rule:RecipientRule={
 ownerId:'owner',
 dependentId:'dependent',
 canonicalName:'Agata Luana Tavares dos Santos',
 normalizedName:'agata luana tavares dos santos',
 pensionAmountCents:80000,
 pensionDayStart:5,
 pensionDayEnd:20,
 importFrom:'2026-08-01'
};
const tx=(overrides:Partial<BankFeedTransaction>={}):BankFeedTransaction=>({
 id:'tx',itemId:'item',accountId:'account',amount:800,originalAmount:-800,
 chargeDate:'2026-11-05',type:'DEBIT',status:'POSTED',operationType:'PIX',
 description:'Pix enviado Agata Luana Tavares dos Santos',descriptionRaw:null,
 counterpartyName:null,counterpartyKind:'person',paymentMethod:'PIX',...overrides
});

describe('bank automation',()=>{
 it('normaliza nome independentemente de acentos, caixa e pontuação',()=>{
  expect(normalizeBankText(' ÁGATA  Luana-Tavares dos Santos ')).toBe('agata luana tavares dos santos');
 });
 it('usa receiver quando disponível e description como fallback real da Pluggy',()=>{
  expect(matchRecipient(tx({counterpartyName:'AGATA LUANA TAVARES DOS SANTOS'}),rule)).toBe('receiver');
  expect(matchRecipient(tx({counterpartyName:null,descriptionRaw:'PIX ENVIADO AGATA LUANA TAVARES DOS SANTOS'}),rule)).toBe('description');
  expect(matchRecipient(tx({counterpartyName:null,description:'Pix enviado Outra Pessoa'}),rule)).toBeNull();
 });
 it('classifica apenas R$ 800 entre os dias 5 e 20 como pensão',()=>{
  expect(classifyTransfer(80000,'2026-11-05',rule)).toBe('pensao');
  expect(classifyTransfer(80000,'2026-11-20',rule)).toBe('pensao');
  expect(classifyTransfer(80000,'2026-11-04',rule)).toBe('adicional');
  expect(classifyTransfer(30000,'2026-11-10',rule)).toBe('adicional');
 });
 it('converte dinheiro para centavos inteiros e mantém janela de sobreposição',()=>{
  expect(moneyToCents(800)).toBe(80000);
  expect(moneyToCents(-12.34)).toBe(1234);
  expect(overlapStart('2026-08-01',null)).toBe('2026-08-01');
  expect(overlapStart('2026-08-01','2026-11-05')).toBe('2026-10-22');
 });
});
