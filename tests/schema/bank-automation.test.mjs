import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';

const core='supabase/migrations/20261105151325_facts_bank_automation_core.sql';
const runtime='supabase/migrations/20261105152515_facts_bank_service_role_rpc.sql';
const scheduler='supabase/migrations/20261105152248_facts_bank_scheduler_extensions.sql';
const edge='supabase/functions/bank-sync/index.ts';

const sql=(path)=>readFileSync(path,'utf8').replace(/\s+/g,' ').toLowerCase();

test('automação bancária é idempotente, privada e auditada',()=>{
 assert.equal(existsSync(core),true);
 assert.equal(existsSync(runtime),true);
 assert.equal(existsSync(scheduler),true);
 assert.equal(existsSync(edge),true);

 const c=sql(core);
 assert.match(c,/create table public\.facts_bank_recipient_rules/);
 assert.match(c,/create table public\.facts_bank_transactions/);
 assert.match(c,/unique \(owner_id, provider, provider_transaction_id\)/);
 assert.match(c,/sync_state text not null default 'seen'/);
 assert.match(c,/alter table public\.facts_bank_transactions enable row level security/);
 assert.match(c,/revoke all on public\.facts_bank_connections, public\.facts_bank_recipient_rules, public\.facts_bank_transactions from public, anon, authenticated/);

 const r=sql(runtime);
 assert.match(r,/security definer/);
 assert.match(r,/grant execute on function public\.facts_bank_runtime_config\(\) to service_role/);
 assert.match(r,/grant execute on function public\.facts_import_bank_transaction/);
 assert.match(r,/revoke all on function public\.facts_import_bank_transaction.*from public, anon, authenticated/);
 assert.match(r,/insert into public\.facts_mutations/);
 assert.match(r,/insert into public\.facts_audit_entries/);

 const s=sql(scheduler);
 assert.match(s,/create extension if not exists pg_net/);
 assert.match(s,/create extension if not exists pg_cron/);
});
