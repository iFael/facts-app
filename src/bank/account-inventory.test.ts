import {describe,it,expect} from 'vitest';
import {cardAppearance,mapPluggyAccount} from './account-inventory';

const id='a658c848-e475-457b-8565-d1fffba127c4';
const credit={
  id,type:'CREDIT',name:'Mastercard Black',marketingName:'Itaú Uniclass Mastercard Black',
  number:'xxxx8670',balance:1229.48,currencyCode:'BRL',updatedAt:'2026-11-10T12:34:56Z',
  creditData:{
    brand:'MASTERCARD',level:'BLACK',status:'ACTIVE',holderType:'MAIN',
    creditLimit:4500.00,availableCreditLimit:3270.52,
    balanceDueDate:'2026-11-15',balanceCloseDate:'2026-11-05',
  },taxNumber:'SECRET_CPF',owner:'SECRET_NAME',
};

describe('Pluggy account inventory',()=>{
  it('returns bank/card fields without personal identity data',()=>{
    const mapped=mapPluggyAccount(credit,'Itaú');
    expect(mapped).toMatchObject({
      type:'CREDIT',name:'Mastercard Black',lastFour:'8670',
      balanceCents:122948,credit:{
        brand:'MASTERCARD',level:'BLACK',reportedBalanceCents:122948,
        creditLimitCents:450000,availableLimitCents:327052,
        dueDate:'2026-11-15',closingDate:'2026-11-05',
      },
    });
    const dumped=JSON.stringify(mapped);
    expect(dumped).not.toContain('SECRET_CPF');
    expect(dumped).not.toContain('SECRET_NAME');
    expect(cardAppearance(mapped)).toEqual({
      label:'Itaú Uniclass Mastercard Black',issuer:'Itaú',theme:'orange',
    });
  });
  it('maps bank accounts without inventing a card or card last four',()=>{
    const mapped=mapPluggyAccount({
      id,type:'BANK',name:'Conta corrente',number:'1234-56789',balance:-72.99,
      currencyCode:'BRL',bankData:{overdraftContractedLimit:500},
    },'Mercado Pago');
    expect(mapped.balanceCents).toBe(-7299);
    expect(mapped.credit).toBeNull();
    expect(mapped.lastFour).toBeNull();
    expect(()=>cardAppearance(mapped)).toThrow('NOT_A_CREDIT_CARD');
  });
  it('does not infer brand, limit or exact visual product',()=>{
    const mapped=mapPluggyAccount({id,type:'CREDIT',name:'Cartão',number:'1234567890123456'},'Banco X');
    expect(mapped.lastFour).toBeNull();
    expect(mapped.credit?.brand).toBeNull();
    expect(mapped.credit?.creditLimitCents).toBeNull();
    expect(mapped.balanceCents).toBeNull();
    expect(cardAppearance(mapped).theme).toBe('neutral');
  });
  it('rejects invalid ids and account types',()=>{
    expect(()=>mapPluggyAccount({id:'fake',type:'CREDIT'},'Itaú')).toThrow();
    expect(()=>mapPluggyAccount({id,type:'INVESTMENT'},'Itaú')).toThrow();
  });
  it('does not invent a valid due date from malformed input',()=>{
    const mapped=mapPluggyAccount({...credit,creditData:{...credit.creditData,balanceDueDate:'2026-02-31'}},'Itaú');
    expect(mapped.credit?.dueDate).toBeNull();
  });
});
