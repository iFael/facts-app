import {expect,it} from 'vitest';
import type {AuditEntry,Dependent} from '../domain/core';
import {FactsService,type AuditFilter,type FactsRepository} from './facts-service';

const dependent:Dependent={
 id:'26000000-0000-4000-8000-000000000001',name:'Noah',birthDate:'2025-07-07',
 createdAt:'2026-09-14T22:20:00.000Z',updatedAt:'2026-09-14T22:20:00.000Z'
};
const audit:AuditEntry={
 id:'26000000-0000-4000-8000-000000000002',mutationId:'26000000-0000-4000-8000-000000000003',
 entityType:'fact',entityId:'26000000-0000-4000-8000-000000000004',action:'update',source:'chat',createdBy:'assistant',
 changedAt:'2026-09-14T22:21:00.000Z',before:{title:'Antes'},after:{title:'Depois'}
};

it('lista dependentes e auditoria como leituras do Facts Service',async()=>{
 const repository={
  getDependent:async(id:string)=>id===dependent.id?dependent:null,
  listDependents:async()=>[dependent],
  listAudit:async(_filter?:AuditFilter)=>[audit]
 } as unknown as FactsRepository;
 const service=new FactsService(repository);
 await expect(service.getDependent(dependent.id)).resolves.toEqual(dependent);
 await expect(service.listDependents()).resolves.toEqual([dependent]);
 await expect(service.listAudit({entityType:'fact',entityId:audit.entityId,limit:50})).resolves.toEqual([audit]);
 await expect(service.listAudit({limit:201} as AuditFilter)).rejects.toThrow();
});
