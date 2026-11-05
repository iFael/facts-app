
create or replace function public.facts_bank_runtime_config()
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 v_feed text;
 v_cron text;
 v_settings jsonb;
 v_rules jsonb;
 v_learning jsonb;
begin
 select decrypted_secret into v_feed from vault.decrypted_secrets where name='facts_bank_feed_token';
 select decrypted_secret into v_cron from vault.decrypted_secrets where name='facts_bank_cron_secret';
 if v_feed is null or v_cron is null then raise exception 'FACTS_BANK_SECRET_MISSING'; end if;
 select coalesce(jsonb_agg(jsonb_build_object(
  'ownerId',s.owner_id,'dependentId',s.dependent_id,'ledgerFrom',s.ledger_from,
  'notifyFrom',s.notify_from,'lastSyncedAt',s.last_synced_at
  )),'[]'::jsonb) into v_settings from public.facts_bank_settings s;
 select coalesce(jsonb_agg(jsonb_build_object(
  'ownerId',r.owner_id,'dependentId',r.dependent_id,'canonicalName',r.canonical_name,
  'normalizedName',r.normalized_name,'pensionAmountCents',r.pension_amount_cents,
  'pensionDayStart',r.pension_day_start,'pensionDayEnd',r.pension_day_end,
  'importFrom',r.import_from
  )),'[]'::jsonb) into v_rules from public.facts_bank_recipient_rules r where r.enabled;
 select coalesce(jsonb_agg(jsonb_build_object(
  'ownerId',r.owner_id,'dependentId',r.dependent_id,'matchKind',r.match_kind,
  'matchValue',r.match_value,'direction',r.direction,'action',r.action,'category',r.category
  )),'[]'::jsonb) into v_learning from public.facts_bank_learning_rules r where r.enabled;
 return jsonb_build_object('feedToken',v_feed,'cronSecret',v_cron,
  'settings',v_settings,'rules',v_rules,'learningRules',v_learning);
end $$;
revoke all on function public.facts_bank_runtime_config() from public,anon,authenticated;
grant execute on function public.facts_bank_runtime_config() to service_role;

create or replace function public.facts_upsert_bank_ledger(p_owner_id uuid,p_entries jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 v_row jsonb;
 v_record public.facts_bank_transactions%rowtype;
 v_is_new boolean;
 v_changed boolean;
 v_direction text;
 v_id text;
 v_date date;
 v_amount bigint;
 v_results jsonb:='[]'::jsonb;
begin
 if p_owner_id is null or not exists(select 1 from public.facts_bank_settings where owner_id=p_owner_id)
 then raise exception 'FACTS_BANK_OWNER_NOT_CONFIGURED' using errcode='22023'; end if;
 if jsonb_typeof(p_entries)<>'array' or jsonb_array_length(p_entries)>250
 then raise exception 'FACTS_BANK_BATCH_INVALID' using errcode='22023'; end if;
 for v_row in select value from jsonb_array_elements(p_entries) loop
  v_id:=v_row->>'id';
  v_direction:=v_row->>'direction';
  if v_id is null or length(v_id) not between 1 and 200
    or v_direction not in ('outgoing','incoming')
    or length(coalesce(v_row->>'itemId','')) not between 1 and 200
    or length(coalesce(v_row->>'accountId','')) not between 1 and 200
    or coalesce(v_row->>'occurredAt','') !~ '^\d{4}-\d{2}-\d{2}$'
    or coalesce(v_row->>'amountCents','') !~ '^\d+$'
  then raise exception 'FACTS_BANK_ROW_INVALID' using errcode='22023'; end if;
  v_date:=(v_row->>'occurredAt')::date;
  v_amount:=(v_row->>'amountCents')::bigint;
  if v_amount<1 or v_amount>99999999999 then raise exception 'FACTS_BANK_AMOUNT_INVALID'; end if;

  select * into v_record from public.facts_bank_transactions
   where owner_id=p_owner_id and provider='pluggy' and provider_transaction_id=v_id
   for update;
  v_is_new:=not found;
  v_changed:=false;
  if v_is_new then
   insert into public.facts_bank_transactions(
    owner_id,provider,provider_transaction_id,item_id,account_id,occurred_at,
    amount_cents,original_amount_cents,direction,description,tx_type,operation_type,
    tx_status,payment_method,counterparty_name,counterparty_kind,match_source,
    institution,category,merchant_name,foreign_charge,relevance,relevance_confidence
   ) values (
    p_owner_id,'pluggy',v_id,v_row->>'itemId',v_row->>'accountId',v_date,
    v_amount,nullif(v_row->>'originalAmountCents','')::bigint,v_direction,
    left(v_row->>'description',2000),left(v_row->>'txType',100),
    left(v_row->>'operationType',100),left(v_row->>'txStatus',100),
    left(v_row->>'paymentMethod',100),left(v_row->>'counterpartyName',200),
    nullif(v_row->>'counterpartyKind',''),null,left(v_row->>'institution',160),
    left(v_row->>'category',160),left(v_row->>'merchantName',200),
    coalesce((v_row->>'foreignCharge')::boolean,false),'unknown',0
   ) returning * into v_record;
  else
   v_changed:=v_record.occurred_at<>v_date or v_record.amount_cents<>v_amount or v_record.direction<>v_direction;
   update public.facts_bank_transactions set
    item_id=v_row->>'itemId',
    account_id=v_row->>'accountId',
    description=left(v_row->>'description',2000),
    tx_type=left(v_row->>'txType',100),
    operation_type=left(v_row->>'operationType',100),
    tx_status=left(v_row->>'txStatus',100),
    payment_method=left(v_row->>'paymentMethod',100),
    counterparty_name=left(v_row->>'counterpartyName',200),
    counterparty_kind=nullif(v_row->>'counterpartyKind',''),
    institution=left(v_row->>'institution',160),
    category=left(v_row->>'category',160),
    merchant_name=left(v_row->>'merchantName',200),
    foreign_charge=coalesce((v_row->>'foreignCharge')::boolean,false),
    last_seen_at=now(),updated_at=now(),
    sync_state=case when v_changed then 'needs_review' else sync_state end
   where id=v_record.id returning * into v_record;
  end if;
  v_results:=v_results||jsonb_build_array(jsonb_build_object(
   'id',v_record.id,'providerId',v_id,'new',v_is_new,'changed',v_changed,
   'factId',v_record.fact_id,'syncState',v_record.sync_state,
   'relevance',v_record.relevance
  ));
 end loop;
 return jsonb_build_object('items',v_results);
end $$;
revoke all on function public.facts_upsert_bank_ledger(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.facts_upsert_bank_ledger(uuid,jsonb) to service_role;

create or replace function public.facts_queue_bank_review(
 p_owner uuid,p_transaction uuid,p_dependent uuid,p_reason text,p_action text
) returns uuid language plpgsql security definer set search_path='' as $$
declare v_review uuid;v_date date;v_notify date;
begin
 select occurred_at into v_date from public.facts_bank_transactions
 where id=p_transaction and owner_id=p_owner and fact_id is null;
 if v_date is null then return null; end if;
 insert into public.facts_bank_reviews(owner_id,transaction_id,dependent_id,reason,suggested_action)
 values(p_owner,p_transaction,p_dependent,p_reason,p_action)
 on conflict(owner_id,transaction_id) do nothing;
 select id into v_review from public.facts_bank_reviews
 where owner_id=p_owner and transaction_id=p_transaction and status='pending';
 if v_review is null then return null; end if;
 update public.facts_bank_transactions set sync_state='needs_review',updated_at=now()
 where id=p_transaction and owner_id=p_owner and sync_state<>'needs_review';
 select notify_from into v_notify from public.facts_bank_settings where owner_id=p_owner;
 if v_date>=v_notify and v_date<=current_date then
  insert into public.facts_bank_notifications(owner_id,transaction_id,kind)
  values(p_owner,p_transaction,'bank_review')
  on conflict(owner_id,transaction_id,kind) do nothing;
 end if;
 return v_review;
end $$;
revoke all on function public.facts_queue_bank_review(uuid,uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.facts_queue_bank_review(uuid,uuid,uuid,text,text) to service_role;

create or replace function public.facts_queue_bank_event(p_owner uuid,p_transaction uuid)
returns boolean language plpgsql security definer set search_path='' as $$
declare v_date date;v_notify date;
begin
 select occurred_at into v_date from public.facts_bank_transactions
 where owner_id=p_owner and id=p_transaction;
 select notify_from into v_notify from public.facts_bank_settings where owner_id=p_owner;
 if v_date is null or v_notify is null or v_date<v_notify or v_date>current_date then return false; end if;
 insert into public.facts_bank_notifications(owner_id,transaction_id,kind)
 values(p_owner,p_transaction,'bank_event')
 on conflict(owner_id,transaction_id,kind) do nothing;
 return true;
end $$;
revoke all on function public.facts_queue_bank_event(uuid,uuid) from public,anon,authenticated;
grant execute on function public.facts_queue_bank_event(uuid,uuid) to service_role;

create or replace function public.facts_claim_bank_notifications(p_limit integer default 20)
returns setof public.facts_bank_notifications language plpgsql
security definer set search_path='' as $$
begin
 return query
 with claimed as(
  select id from public.facts_bank_notifications
  where (status in ('pending','failed') or (status='sending' and updated_at<now()-interval '10 minutes'))
    and attempts<5
  order by created_at,id
  for update skip locked
  limit least(greatest(coalesce(p_limit,20),1),30)
 )
 update public.facts_bank_notifications n
 set status='sending',attempts=n.attempts+1,updated_at=now()
 from claimed where n.id=claimed.id
 returning n.*;
end $$;
revoke all on function public.facts_claim_bank_notifications(integer) from public,anon,authenticated;
grant execute on function public.facts_claim_bank_notifications(integer) to service_role;
