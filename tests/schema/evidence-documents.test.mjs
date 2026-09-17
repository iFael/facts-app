import {existsSync,readFileSync} from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';

const path='supabase/migrations/20260914215000_facts_evidence_documents.sql';
const sql=()=>readFileSync(path,'utf8').replace(/\s+/g,' ').toLowerCase();

test('documentos preservam original, evidência derivada e auditoria idempotente',()=>{
 assert.equal(existsSync(path),true,'migration de evidências/documentos ainda não existe');
 const s=sql();
 assert.match(s,/add constraint facts_evidence_one_per_attachment unique\(owner_id,attachment_id\)/);
 assert.match(s,/create index facts_evidence_links_fact_idx on public\.facts_evidence_links\(owner_id,fact_id\)/);
 for(const fn of ['facts_register_attachment','facts_create_evidence','facts_update_evidence','facts_delete_evidence','facts_delete_attachment'])assert.match(s,new RegExp(`create function public\\.${fn}\\(`));
 assert.match(s,/storage\.objects/);
 assert.match(s,/facts-attachments/);
 assert.match(s,/facts_attachment_object_not_found/);
 assert.match(s,/facts_attachment_in_use/);
 assert.match(s,/perform public\._facts_write_audit\(p_mutation_id,'attachment'/);
 assert.match(s,/perform public\._facts_write_audit\(p_mutation_id,'evidence'/);
 assert.match(s,/grant execute on function public\.facts_register_attachment/);
 assert.match(s,/grant execute on function public\.facts_create_evidence/);
 assert.doesNotMatch(s,/drop table public\.facts_snapshots/);
});
