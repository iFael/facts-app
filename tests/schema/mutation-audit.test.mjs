import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname,resolve} from 'node:path';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const migration=resolve(root,'supabase/migrations/20260914212500_facts_mutation_audit.sql');

test('mutations são idempotentes, auditadas e operadas somente por RPC de domínio',()=>{
 assert.equal(existsSync(migration),true,'migration de mutation/audit ainda não existe');
 const sql=readFileSync(migration,'utf8').toLowerCase();
 for(const column of ['operation text not null','entity_type text not null','entity_id uuid not null','request_payload jsonb not null','result_payload jsonb','completed_at timestamptz']){
  assert.match(sql,new RegExp(column.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')),`campo de mutation ausente: ${column}`);
 }
 for(const fn of ['_facts_begin_mutation','_facts_finish_mutation','_facts_write_audit','facts_upsert_dependent','facts_create_fact','facts_update_fact','facts_delete_fact','facts_link_request','facts_unlink_request']){
  assert.match(sql,new RegExp(`create function public\\.${fn}\\b`),`função ${fn} ausente`);
 }
 assert.match(sql,/security definer/);
 assert.match(sql,/set search_path=''/);
 assert.match(sql,/revoke insert,update,delete on public\.facts_dependents,public\.facts,public\.facts_attachments,public\.facts_evidence,public\.facts_evidence_links,public\.facts_relationships,public\.facts_mutations,public\.facts_audit_entries from authenticated/);
 assert.match(sql,/revoke all on function public\._facts_begin_mutation/);
 assert.match(sql,/grant execute on function public\.facts_create_fact/);
 assert.match(sql,/facts_mutation_id_reused/);
 assert.doesNotMatch(sql,/service_role/);
 assert.doesNotMatch(sql,/alter\s+table\s+public\.facts_snapshots/);
 assert.doesNotMatch(sql,/delete\s+from\s+public\.facts_snapshots/);
});
