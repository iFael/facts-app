import {describe,expect,it} from 'vitest';
import {registerFactsTools,type FactsToolHost} from './tools';
import type {FactsService} from '../service/facts-service';
import type {FactsDocumentsService} from '../service/documents-service';

class Host implements FactsToolHost{
 tools=new Map<string,{handler:(args:unknown)=>Promise<unknown>} >();
 registerTool(name:string,_config:unknown,handler:(args:unknown)=>Promise<unknown>){this.tools.set(name,{handler});}
}

const dependentId='26000000-0000-4000-8000-000000000001';
const mutationId='26000000-0000-4000-8000-000000000002';

describe('Facts MCP tools',()=>{
 it('registra superfície assistant-first consolidada sem expor RPC/SQL',()=>{
  const host=new Host();
  registerFactsTools(host,{} as FactsService,{} as FactsDocumentsService);
  expect([...host.tools.keys()]).toEqual(expect.arrayContaining([
   'facts_list_dependents','facts_delete_dependent','facts_create_fact','facts_list_facts','facts_get_report','facts_list_audit',
   'facts_list_documents','facts_ingest_document','facts_update_evidence','facts_delete_document'
  ]));
  expect([...host.tools.keys()].some(name=>name.includes('rpc')||name.includes('sql'))).toBe(false);
 });

 it('força proveniência chat/assistant e mutationId nas escritas',async()=>{
  const calls:unknown[]=[];
  const facts={createExpense:async(context:unknown,input:unknown)=>{calls.push({context,input});return {ok:true};}} as unknown as FactsService;
  const host=new Host();
  registerFactsTools(host,facts,{} as FactsDocumentsService);
  const handler=host.tools.get('facts_create_fact')?.handler;
  expect(handler).toBeDefined();
  await handler!({mutationId,fact:{kind:'expense',dependentId,title:'Farmácia',category:'saude',notes:'',occurredAt:'2026-09-14',amountCents:2590,provenanceKind:'user_assertion'}});
  expect(calls[0]).toMatchObject({context:{mutationId,source:'chat',createdBy:'assistant'},input:{dependentId,amountCents:2590}});
  await expect(handler!({fact:{kind:'expense',dependentId,title:'Sem id',category:'outros',notes:'',occurredAt:'2026-09-14',amountCents:100,provenanceKind:'user_assertion'}})).rejects.toThrow();
 });

 it('decodifica documento base64 antes de delegar ao serviço',async()=>{
  let received:Uint8Array|undefined;
  const documents={ingestDocument:async(_context:unknown,_input:unknown,bytes:Uint8Array)=>{received=bytes;return {ok:true};}} as unknown as FactsDocumentsService;
  const host=new Host();
  registerFactsTools(host,{} as FactsService,documents);
  const handler=host.tools.get('facts_ingest_document')?.handler;
  await handler!({mutationId,document:{name:'comprovante.txt',mime:'text/plain',source:'document',factIds:[]},contentBase64:btoa('abc')});
  expect(Array.from(received??[])).toEqual([97,98,99]);
 });
});
