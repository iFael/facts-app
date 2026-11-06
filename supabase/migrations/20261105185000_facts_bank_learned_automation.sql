
create or replace function public.facts_auto_book_noah_expense(
 p_owner uuid,p_transaction uuid,p_merchant_key text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
 v_tx public.facts_bank_transactions%rowtype;
 v_rule public.facts_bank_learning_rules%rowtype;
 v_id uuid;
 v_mutation uuid;
 v_snapshot jsonb;
 v_notes text;
begin
 if p_owner is null or p_transaction is null or coalesce(p_merchant_key,'')=''
 then raise exception 'FACTS_BANK_AUTO_INPUT_INVALID' using errcode='22023'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_transaction::text,0));
 select * into v_tx from public.facts_bank_transactions
 where owner_id=p_owner and id=p_transaction for update;
 if not found then raise exception 'FACTS_BANK_TRANSACTION_NOT_FOUND' using errcode='P0002'; end if;
 if v_tx.fact_id is not null then return jsonb_build_object('status','replayed','factId',v_tx.fact_id); end if;
 if v_tx.direction<>'outgoing' or v_tx.foreign_charge or v_tx.sync_state='needs_review'
 or v_tx.tx_status is distinct from 'POSTED'
 then return jsonb_build_object('status','skipped'); end if;
 if exists(select 1 from public.facts_bank_reviews where owner_id=p_owner and transaction_id=p_transaction and status='pending')
 then return jsonb_build_object('status','skipped'); end if;
 select * into v_rule from public.facts_bank_learning_rules
 where owner_id=p_owner and enabled and match_kind='merchant'
  and match_value=p_merchant_key and direction='outgoing' and action='noah_expense'
 limit 1;
 if not found then raise exception 'FACTS_BANK_LEARNED_RULE_NOT_FOUND' using errcode='P0002'; end if;
 v_id:=gen_random_uuid();
 v_mutation:=gen_random_uuid();
 v_notes:='Gasto do Noah reconhecido por regra confirmada. Transação Pluggy: '||v_tx.provider_transaction_id||'.';
 insert into public.facts_mutations(
  owner_id,mutation_id,source,created_by,created_at,operation,entity_type,entity_id,
  request_payload,result_payload,completed_at
 ) values(
  p_owner,v_mutation,'import','assistant',now(),'auto_noah_expense','fact',v_id,
  jsonb_build_object('bankTransactionId',p_transaction,'learningRuleId',v_rule.id),null,null
 );
 insert into public.facts(
  id,owner_id,dependent_id,kind,title,category,notes,occurred_at,amount_cents,
  transfer_purpose,request_total_cents,source,source_detail,created_by,provenance_kind,created_at,updated_at
 ) values(
  v_id,p_owner,v_rule.dependent_id,'expense',
  left('Gasto do Noah — '||coalesce(nullif(v_tx.merchant_name,''),v_tx.description,'Compra'),160),
  coalesce(v_rule.category,'outros'),v_notes,v_tx.occurred_at,v_tx.amount_cents,
  null,null,'import','Pluggy — regra aprendida','assistant','imported',now(),now()
 );
 select to_jsonb(f)-'owner_id' into v_snapshot from public.facts f where f.id=v_id;
 insert into public.facts_audit_entries(id,owner_id,mutation_id,entity_type,entity_id,action,source,created_by,changed_at,before_state,after_state)
 values(gen_random_uuid(),p_owner,v_mutation,'fact',v_id,'create','import','assistant',now(),null,v_snapshot);
 update public.facts_mutations set result_payload=v_snapshot,completed_at=now()
 where owner_id=p_owner and mutation_id=v_mutation;
 update public.facts_bank_transactions set
  fact_id=v_id,classification='noah_expense',relevance='noah',
  relevance_confidence=100,sync_state='imported',updated_at=now()
 where owner_id=p_owner and id=p_transaction;
 return jsonb_build_object('status','imported','factId',v_id);
end $$;
revoke all on function public.facts_auto_book_noah_expense(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.facts_auto_book_noah_expense(uuid,uuid,text) to service_role;

-- Serialize same-transaction ingestion even when a webhook overlaps the scheduler.
create or replace function public.facts_bank_lock_key(p_owner uuid,p_provider_id text)
returns void language sql security invoker set search_path='' as $$
 select pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_owner::text||':'||p_provider_id,0));
$$;
revoke all on function public.facts_bank_lock_key(uuid,text) from public,anon,authenticated;
grant execute on function public.facts_bank_lock_key(uuid,text) to service_role;
