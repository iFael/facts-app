import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';

const sql=readFileSync(new URL('../../supabase/migrations/20261111011500_facts_agent_bridge.sql',import.meta.url),'utf8');

test('ponte usa apenas user JWT, RLS por owner e presença sem token de IA',()=>{
 assert.match(sql,/create table if not exists public\.facts_agent_jobs/);
 assert.match(sql,/create table if not exists public\.facts_agent_presence/);
 assert.match(sql,/enable row level security/g);
 assert.match(sql,/owner_id=\(select auth\.uid\(\)\)/);
 assert.match(sql,/with check \(owner_id=\(select auth\.uid\(\)\)\)/);
 assert.match(sql,/revoke all on public\.facts_agent_jobs from public,anon,authenticated/);
 assert.match(sql,/grant select,insert,update,delete on public\.facts_agent_jobs to authenticated/);
 assert.doesNotMatch(sql,/service_role|access_token|refresh_token|client_secret/i);
});

test('mensagens são temporárias, com limites e expiração no servidor',()=>{
 assert.match(sql,/char_length\(btrim\(question\)\) between 1 and 1000/);
 assert.match(sql,/octet_length\(history::text\)<=11000/);
 assert.match(sql,/expires_at timestamptz not null default \(now\(\)\+interval '3 minutes'\)/);
 assert.match(sql,/cron\.schedule\('facts-agent-purge-expired'/);
});
