import {describe,expect,it} from 'vitest';
import type {Attachment,Evidence} from '../domain/core';
import {FactsDocumentsService,type DeleteDocumentResult,type DocumentRecord,type DocumentsRepository,type EvidenceUpdateInput} from './documents-service';
import type {MutationContext} from './facts-service';

const context:MutationContext={mutationId:'23000000-0000-4000-8000-000000000001',source:'chat',createdBy:'assistant'};
const stamp='2026-09-14T22:00:00.000Z';

class Repo implements DocumentsRepository{
 events:string[]=[];
 attachment:Attachment|null=null;
 evidence:Evidence|null=null;
 storedBytes=new Uint8Array();
 async putObject(attachment:Attachment,bytes:Uint8Array){this.events.push('put');this.attachment=attachment;this.storedBytes=Uint8Array.from(bytes);}
 async downloadObject(){this.events.push('download');return Uint8Array.from(this.storedBytes);}
 async removeObject(){this.events.push('remove');}
 async ingestDocument(_context:MutationContext,input:{attachment:Attachment;evidence:Omit<Evidence,'createdAt'>}):Promise<DocumentRecord>{
  this.events.push('ingest');this.attachment=input.attachment;this.evidence={...input.evidence,createdAt:stamp};return {attachment:input.attachment,evidence:this.evidence};
 }
 async updateEvidence(_context:MutationContext,id:string,input:EvidenceUpdateInput){this.events.push('update');if(!this.evidence||this.evidence.id!==id)throw new Error('missing');this.evidence={...this.evidence,...input};return this.evidence;}
 async deleteDocument(_context:MutationContext,evidenceId:string):Promise<DeleteDocumentResult>{
  this.events.push('delete-db');if(!this.attachment)throw new Error('missing');return {evidenceId,attachment:this.attachment,deleted:true};
 }
 async getAttachment(){return this.attachment;}
 async getEvidence(){return this.evidence;}
 async listDocuments(){return this.attachment&&this.evidence?[{attachment:this.attachment,evidence:this.evidence}]:[];}
}

describe('FactsDocumentsService',()=>{
 it('calcula SHA-256, usa mutationId como identidade estável e ingere original antes da Evidence',async()=>{
  const repo=new Repo(),service=new FactsDocumentsService(repo);
  const bytes=new TextEncoder().encode('hello');
  const result=await service.ingestDocument(context,{name:'comprovante.txt',mime:'text/plain',source:'document',factIds:[],extractedText:'hello'},bytes);
  expect(result.attachment.id).toBe(context.mutationId);
  expect(result.evidence.id).toBe(context.mutationId);
  expect(result.attachment.size).toBe(5);
  expect(result.attachment.sha256).toBe('2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
  expect(repo.events).toEqual(['put','ingest']);
 });

 it('rejeita factIds duplicados antes de tocar no Storage',async()=>{
  const repo=new Repo(),service=new FactsDocumentsService(repo),factId='23000000-0000-4000-8000-000000000099';
  await expect(service.ingestDocument(context,{name:'x.txt',mime:'text/plain',source:'document',factIds:[factId,factId]},new Uint8Array([1]))).rejects.toThrow('duplicados');
  expect(repo.events).toEqual([]);
 });

 it('falha fechado se os bytes baixados não correspondem ao SHA registrado',async()=>{
  const repo=new Repo(),service=new FactsDocumentsService(repo),bytes=new TextEncoder().encode('hello');
  const saved=await service.ingestDocument(context,{name:'x.txt',mime:'text/plain',source:'document',factIds:[]},bytes);
  repo.storedBytes=new TextEncoder().encode('alterado');
  await expect(service.downloadAttachment(saved.attachment.id)).rejects.toThrow('integridade');
 });

 it('remove metadata auditada antes do objeto e permite que retry repita a remoção do Storage',async()=>{
  const repo=new Repo(),service=new FactsDocumentsService(repo),bytes=new Uint8Array([1,2,3]);
  const saved=await service.ingestDocument(context,{name:'x.bin',mime:'application/octet-stream',source:'document',factIds:[]},bytes);
  repo.events=[];
  await service.deleteDocument({...context,mutationId:'23000000-0000-4000-8000-000000000002'},saved.evidence.id);
  expect(repo.events).toEqual(['delete-db','remove']);
 });
});
