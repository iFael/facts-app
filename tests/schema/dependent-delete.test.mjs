import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname,resolve} from 'node:path';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const migration=resolve(root,'supabase/migrations/20260914224500_facts_delete_dependent.sql');

test('dependente pode ser removido por mutação idempotente e auditada',()=>{
 assert.equal(existsSync(migration),true,'migration de delete dependent ainda não existe');
 const sql=readFileSync(migration,'utf8').toLowerCase();
 assert.match(sql,/create function public\.facts_delete_dependent\s*\(/);
 assert.match(sql,/_facts_begin_mutation\(p_mutation_id,'delete_dependent','dependent',p_id/);
 assert.match(sql,/_facts_write_audit\(p_mutation_id,'dependent',p_id,'delete'/);
 assert.match(sql,/delete from public\.facts_dependents where owner_id=v_owner and id=p_id/);
 assert.match(sql,/grant execute on function public\.facts_delete_dependent\(uuid,uuid,text,text\) to authenticated/);
 assert.doesNotMatch(sql,/service_role/);
 assert.doesNotMatch(sql,/facts_snapshots/);
});
