import {existsSync,readFileSync} from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';

const path='supabase/migrations/20260914221500_facts_document_delete.sql';
const sql=()=>readFileSync(path,'utf8').replace(/\s+/g,' ').toLowerCase();

test('exclusão de documento remove Evidence + metadata em uma mutação auditada',()=>{
 assert.equal(existsSync(path),true,'migration de exclusão consolidada ainda não existe');
 const s=sql();
 assert.match(s,/create function public\.facts_delete_document\(/);
 assert.match(s,/_facts_begin_mutation\(p_mutation_id,'delete_document','evidence'/);
 assert.match(s,/delete from public\.facts_evidence_links/);
 assert.match(s,/delete from public\.facts_evidence/);
 assert.match(s,/delete from public\.facts_attachments/);
 assert.match(s,/_facts_write_audit\(p_mutation_id,'evidence'/);
 assert.match(s,/_facts_write_audit\(p_mutation_id,'attachment'/);
 assert.match(s,/revoke execute on function public\.facts_delete_evidence.*from authenticated/);
 assert.match(s,/revoke execute on function public\.facts_delete_attachment.*from authenticated/);
 assert.match(s,/grant execute on function public\.facts_delete_document/);
});
