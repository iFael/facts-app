alter table public.facts_bank_transactions drop constraint if exists facts_bank_transactions_direction_check;
alter table public.facts_bank_transactions add constraint facts_bank_transactions_direction_check check (direction in ('incoming','outgoing','unknown'));
CREATE OR REPLACE FUNCTION public.facts_upsert_bank_ledger(p_owner_id uuid, p_entries jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
    or v_direction not in ('outgoing','incoming','unknown')
    or length(coalesce(v_row->>'itemId','')) not between 1 and 200
    or length(coalesce(v_row->>'accountId','')) not between 1 and 200
    or coalesce(v_row->>'occurredAt','') !~ '^\d{4}-\d{2}-\d{2}$'
    or coalesce(v_row->>'amountCents','') !~ '^\d+$'
  then raise exception 'FACTS_BANK_ROW_INVALID' using errcode='22023'; end if;
  v_date:=(v_row->>'occurredAt')::date;
  v_amount:=(v_row->>'amountCents')::bigint;
  if v_amount<1 or v_amount>99999999999 then raise exception 'FACTS_BANK_AMOUNT_INVALID'; end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_owner_id::text||':'||v_id,0));
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
end $function$;
revoke all on function public.facts_upsert_bank_ledger(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.facts_upsert_bank_ledger(uuid,jsonb) to service_role;
