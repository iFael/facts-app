import {existsSync,readFileSync} from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';

const path='supabase/migrations/20260914220500_facts_document_ingest.sql';
const sql=()=>readFileSync(path,'utf8').replace(/\s+/g,' ').toLowerCase();

test('ingestão de documento usa uma mutação para original + Evidence',()=>{
 assert.equal(existsSync(path),true,'migration de ingestão ainda não existe');
 const s=sql();
 assert.match(s,/create function public\.facts_ingest_document\(/);
 assert.match(s,/_facts_begin_mutation\(p_mutation_id,'ingest_document','evidence'/);
 assert.match(s,/insert into public\.facts_attachments/);
 assert.match(s,/insert into public\.facts_evidence/);
 assert.match(s,/insert into public\.facts_evidence_links/);
 assert.match(s,/_facts_write_audit\(p_mutation_id,'attachment'/);
 assert.match(s,/_facts_write_audit\(p_mutation_id,'evidence'/);
 assert.match(s,/revoke execute on function public\.facts_register_attachment.*from authenticated/);
 assert.match(s,/revoke execute on function public\.facts_create_evidence.*from authenticated/);
 assert.match(s,/grant execute on function public\.facts_ingest_document/);
});
