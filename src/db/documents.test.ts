import {describe,expect,it} from 'vitest';
import type {SupabaseClient} from '@supabase/supabase-js';
import {FactsDocumentsService} from '../service/documents-service';
import {SupabaseDocumentsRepository} from './documents';

const owner='24000000-0000-4000-8000-000000000001';
const mutationId='24000000-0000-4000-8000-000000000002';
const stamp='2026-09-14T22:05:00.000Z';

describe('SupabaseDocumentsRepository',()=>{
 it('faz upload content-addressed e usa uma única RPC para Attachment + Evidence',async()=>{
  let path='',uploadOptions:Record<string,unknown>={},rpcName='',rpcArgs:Record<string,unknown>={};
  const client={
   auth:{getUser:async()=>({data:{user:{id:owner}},error:null})},
   storage:{from:()=>({
    upload:async(p:string,_bytes:Uint8Array,options:Record<string,unknown>)=>{path=p;uploadOptions=options;return {data:{path:p},error:null};},
    download:async()=>({data:null,error:{message:'not used'}}),remove:async()=>({data:[],error:null})
   })},
   rpc:async(name:string,args:Record<string,unknown>)=>{
    rpcName=name;rpcArgs=args;
    return {data:{
     attachment:{id:mutationId,name:'doc.txt',mime:'text/plain',size:5,sha256:'2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824',created_at:stamp},
     evidence:{id:mutationId,attachment_id:mutationId,source:'document',extracted_text:'hello',interpretation:null,created_at:stamp,fact_ids:[]}
    },error:null};
   }
  } as unknown as SupabaseClient;
  const service=new FactsDocumentsService(new SupabaseDocumentsRepository(client));
  const result=await service.ingestDocument({mutationId,source:'chat',createdBy:'assistant'},{name:'doc.txt',mime:'text/plain',source:'document',factIds:[],extractedText:'hello'},new TextEncoder().encode('hello'));
  expect(path).toBe(`${owner}/${mutationId}/${result.attachment.sha256}`);
  expect(uploadOptions).toMatchObject({upsert:false,contentType:'text/plain'});
  expect(rpcName).toBe('facts_ingest_document');
  expect(rpcArgs).toMatchObject({p_mutation_id:mutationId,p_attachment_id:mutationId,p_evidence_id:mutationId,p_size:5,p_evidence_source:'document'});
  expect(result.evidence.attachmentId).toBe(result.attachment.id);
 });

 it('trata retry de upload como sucesso somente quando o objeto existente tem os mesmos bytes',async()=>{
  const existing=new TextEncoder().encode('hello');
  const uploadError={message:'The resource already exists'};
  const client={
   auth:{getUser:async()=>({data:{user:{id:owner}},error:null})},
   storage:{from:()=>({
    upload:async()=>({data:null,error:uploadError}),
    download:async()=>({data:new Blob([existing]),error:null}),
    remove:async()=>({data:[],error:null})
   })}
  } as unknown as SupabaseClient;
  const repo=new SupabaseDocumentsRepository(client);
  await expect(repo.putObject({id:mutationId,name:'doc.txt',mime:'text/plain',size:5,sha256:'2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824'},existing)).resolves.toBeUndefined();
  const altered=new TextEncoder().encode('HELLO');
  await expect(repo.putObject({id:mutationId,name:'doc.txt',mime:'text/plain',size:5,sha256:'x'.repeat(64)},altered)).rejects.toBe(uploadError);
 });
});
