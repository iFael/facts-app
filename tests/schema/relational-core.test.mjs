import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname,resolve} from 'node:path';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const migration=resolve(root,'supabase/migrations/20260914210000_facts_relational_core.sql');

test('migration relacional é aditiva e cobre o Domain Core',()=>{
 assert.equal(existsSync(migration),true,'migration relacional ainda não existe');
 const sql=readFileSync(migration,'utf8').toLowerCase();
 for(const table of ['facts_dependents','facts','facts_attachments','facts_evidence','facts_evidence_links','facts_relationships','facts_mutations','facts_audit_entries']){
  assert.match(sql,new RegExp(`create table public\\.${table}\\b`),`tabela ${table} ausente`);
  assert.match(sql,new RegExp(`alter table public\\.${table} enable row level security`),`RLS ausente em ${table}`);
 }
 assert.match(sql,/amount_cents bigint/);
 assert.match(sql,/request_total_cents bigint/);
 assert.match(sql,/kind text not null check \(kind in \('expense','payment','transfer','request','event'\)\)/);
 assert.match(sql,/kind text not null check \(kind='fulfills_request'\)/);
 assert.match(sql,/kind in \('expense','payment','transfer','request'\) and amount_cents is not null and amount_cents between 1 and 99999999999/);
 assert.match(sql,/kind='transfer' and transfer_purpose is not null and transfer_purpose in \('pensao','adicional','reembolso'\)/);
 assert.match(sql,/create trigger facts_relationships_validate/);
 assert.match(sql,/primary key \(owner_id,mutation_id\)/);
 assert.match(sql,/before_state jsonb/);
 assert.match(sql,/after_state jsonb/);
 assert.doesNotMatch(sql,/drop\s+(table|function)\s+public\.facts_snapshots/);
 assert.doesNotMatch(sql,/alter\s+table\s+public\.facts_snapshots/);
 assert.doesNotMatch(sql,/delete\s+from\s+public\.facts_snapshots/);
 assert.doesNotMatch(sql,/service_role/);
});
