import {describe,expect,it} from 'vitest';
import {attachmentSchema,auditEntrySchema,dependentSchema,evidenceSchema,factRelationshipSchema,factSchema,mutationSchema,validateFactRelationship} from './core';

const stamp='2026-09-14T20:45:00.000Z';
const base={
 id:'11111111-1111-4111-8111-111111111111',
 dependentId:'22222222-2222-4222-8222-222222222222',
 title:'Medicamento',
 category:'saude',
 notes:'',
 occurredAt:'2026-09-14',
 source:'chat',
 createdBy:'assistant',
 provenanceKind:'user_assertion',
 createdAt:stamp,
 updatedAt:stamp
} as const;

describe('domain core',()=>{
 it('aceita fato financeiro com proveniência explícita e centavos inteiros',()=>{
  const fact=factSchema.parse({...base,kind:'expense',amountCents:12345});
  expect(fact.kind).toBe('expense');
  if(fact.kind!=='expense')throw new Error('Tipo inesperado no teste.');
  expect(fact.amountCents).toBe(12345);
  expect(fact.source).toBe('chat');
  expect(fact.createdBy).toBe('assistant');
  expect(fact.provenanceKind).toBe('user_assertion');
  expect(()=>factSchema.parse({...base,kind:'expense',amountCents:'12345'})).toThrow();
 });

 it('preserva o detalhe da origem sem transformar canal legado em enum operacional',()=>{
  const fact=factSchema.parse({...base,kind:'expense',amountCents:2500,source:'import',sourceDetail:'WhatsApp'});
  expect(fact.source).toBe('import');
  expect(fact.sourceDetail).toBe('WhatsApp');
 });

 it('modela payment, transfer, request e event sem inventar valor para acontecimento',()=>{
  expect(factSchema.parse({...base,kind:'payment',amountCents:5000}).kind).toBe('payment');
  expect(factSchema.parse({...base,kind:'transfer',amountCents:80000,transferPurpose:'pensao'}).kind).toBe('transfer');
  expect(factSchema.parse({...base,kind:'request',amountCents:12000,requestTotalCents:24000}).kind).toBe('request');
  expect(factSchema.parse({...base,kind:'event'}).kind).toBe('event');
  expect(()=>factSchema.parse({...base,kind:'event',amountCents:1000})).toThrow();
 });

 it('mantém o arquivo original separado das derivações de OCR e interpretação',()=>{
  const attachment=attachmentSchema.parse({
   id:'33333333-3333-4333-8333-333333333333',name:'comprovante.pdf',mime:'application/pdf',size:2048,
   sha256:'a'.repeat(64)
  });
  const evidence=evidenceSchema.parse({
   id:'44444444-4444-4444-8444-444444444444',attachmentId:attachment.id,
   factIds:[base.id],source:'document',extractedText:'PIX realizado R$ 50,00',
   interpretation:{documentType:'Comprovante bancário',suggestedKind:'payment',suggestedCategory:'saude',values:[{cents:5000,label:'Total',context:'R$ 50,00'}],dates:['2026-09-14'],createdAt:stamp},
   createdAt:stamp
  });
  expect(evidence.attachmentId).toBe(attachment.id);
  expect(evidence.interpretation?.values[0].cents).toBe(5000);
  expect(attachment.sha256).toHaveLength(64);
 });

 it('preserva vínculo de qualquer desembolso com solicitação sem reclassificar o fato',()=>{
  const relationship=factRelationshipSchema.parse({
   id:'55555555-5555-4555-8555-555555555555',kind:'fulfills_request',
   factId:'66666666-6666-4666-8666-666666666666',requestId:'77777777-7777-4777-8777-777777777777',createdAt:stamp
  });
  expect(relationship.kind).toBe('fulfills_request');
  expect(relationship.factId).not.toBe(relationship.requestId);
 });

 it('valida os tipos dos fatos envolvidos em fulfills_request',()=>{
  const expense=factSchema.parse({...base,id:'66666666-6666-4666-8666-666666666666',kind:'expense',amountCents:5000});
  const request=factSchema.parse({...base,id:'77777777-7777-4777-8777-777777777777',kind:'request',amountCents:5000});
  const event=factSchema.parse({...base,id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',kind:'event'});
  const relationship={id:'55555555-5555-4555-8555-555555555555',kind:'fulfills_request',factId:expense.id,requestId:request.id,createdAt:stamp} as const;
  expect(validateFactRelationship(relationship,[expense,request])).toEqual(factRelationshipSchema.parse(relationship));
  expect(()=>validateFactRelationship({...relationship,factId:event.id},[event,request])).toThrow('desembolso');
  expect(()=>validateFactRelationship(relationship,[expense])).toThrow('solicitação');
 });

 it('mantém dependente como entidade explícita',()=>{
  const dependent=dependentSchema.parse({id:base.dependentId,name:'Noah',birthDate:'2025-07-07',createdAt:stamp,updatedAt:stamp});
  expect(dependent.id).toBe(base.dependentId);
  expect(dependent.birthDate).toBe('2025-07-07');
 });

 it('exige mutationId, operação e entidade e representa auditoria com antes e depois explícitos',()=>{
  const mutation=mutationSchema.parse({
   mutationId:'88888888-8888-4888-8888-888888888888',operation:'update_fact',entityType:'fact',entityId:base.id,
   source:'chat',createdBy:'assistant',createdAt:stamp
  });
  const audit=auditEntrySchema.parse({
   id:'99999999-9999-4999-8999-999999999999',mutationId:mutation.mutationId,entityType:'fact',entityId:base.id,
   action:'update',source:'chat',createdBy:'assistant',changedAt:stamp,before:{amountCents:1000},after:{amountCents:2000}
  });
  expect(mutation.operation).toBe('update_fact');
  expect(mutation.entityType).toBe('fact');
  expect(mutation.entityId).toBe(base.id);
  expect(audit.mutationId).toBe(mutation.mutationId);
  expect(audit.before).toEqual({amountCents:1000});
  expect(audit.after).toEqual({amountCents:2000});
  expect(()=>mutationSchema.parse({mutationId:'88888888-8888-4888-8888-888888888888',source:'chat',createdBy:'assistant',createdAt:stamp})).toThrow();
  expect(()=>auditEntrySchema.parse({
   id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',mutationId:mutation.mutationId,entityType:'fact',entityId:base.id,
   action:'create',source:'chat',createdBy:'assistant',changedAt:stamp,after:{amountCents:1000}
  })).toThrow();
 });
});
