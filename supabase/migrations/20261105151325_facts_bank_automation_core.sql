create table public.facts_bank_connections (
  owner_id uuid not null references auth.users(id) on delete cascade,
  provider text not null check (provider = 'pluggy'),
  item_id text not null check (char_length(btrim(item_id)) between 1 and 200),
  status text not null check (status in ('active','error','removed')),
  institution text,
  last_synced_at timestamptz,
  last_data_through date,
  last_error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (owner_id, provider, item_id)
);

create table public.facts_bank_recipient_rules (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  dependent_id uuid not null,
  canonical_name text not null check (char_length(btrim(canonical_name)) between 1 and 160),
  normalized_name text not null check (char_length(btrim(normalized_name)) between 1 and 160),
  pension_amount_cents bigint not null check (pension_amount_cents between 1 and 99999999999),
  pension_day_start smallint not null check (pension_day_start between 1 and 31),
  pension_day_end smallint not null check (pension_day_end between 1 and 31),
  import_from date not null,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, normalized_name),
  constraint facts_bank_rule_day_range check (pension_day_start <= pension_day_end),
  constraint facts_bank_rule_dependent_fk foreign key(owner_id, dependent_id)
    references public.facts_dependents(owner_id, id) on delete restrict
);

create table public.facts_bank_transactions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  provider text not null check (provider = 'pluggy'),
  provider_transaction_id text not null check (char_length(btrim(provider_transaction_id)) between 1 and 200),
  item_id text not null check (char_length(btrim(item_id)) between 1 and 200),
  account_id text not null check (char_length(btrim(account_id)) between 1 and 200),
  occurred_at date not null,
  amount_cents bigint not null check (amount_cents between 1 and 99999999999),
  original_amount_cents bigint,
  direction text not null check (direction in ('outgoing','incoming')),
  description text check (description is null or char_length(description) <= 2000),
  tx_type text,
  operation_type text,
  tx_status text,
  payment_method text,
  counterparty_name text,
  match_source text check (match_source is null or match_source in ('receiver','description')),
  classification text check (classification is null or classification in ('pensao','adicional','reembolso')),
  sync_state text not null default 'seen' check (sync_state in ('seen','linked_existing','imported','needs_review')),
  fact_id uuid,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  unique (owner_id, provider, provider_transaction_id),
  constraint facts_bank_transaction_fact_fk foreign key(owner_id, fact_id)
    references public.facts(owner_id, id) on delete restrict
);

create index facts_bank_transactions_owner_date_idx
  on public.facts_bank_transactions(owner_id, occurred_at desc);
create index facts_bank_transactions_fact_idx
  on public.facts_bank_transactions(owner_id, fact_id)
  where fact_id is not null;
create index facts_bank_connections_status_idx
  on public.facts_bank_connections(provider, status);

alter table public.facts_bank_connections enable row level security;
alter table public.facts_bank_recipient_rules enable row level security;
alter table public.facts_bank_transactions enable row level security;

revoke all on public.facts_bank_connections, public.facts_bank_recipient_rules, public.facts_bank_transactions
  from public, anon, authenticated;

create or replace function public.facts_bank_runtime_config()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_client_id text;
  v_client_secret text;
  v_webhook_secret text;
  v_cron_secret text;
  v_rules jsonb;
  v_connections jsonb;
begin
  if current_user <> 'service_role' then
    raise exception 'FACTS_BANK_SERVICE_ROLE_REQUIRED' using errcode='42501';
  end if;

  select decrypted_secret into v_client_id
  from vault.decrypted_secrets where name='facts_pluggy_client_id';
  select decrypted_secret into v_client_secret
  from vault.decrypted_secrets where name='facts_pluggy_client_secret';
  select decrypted_secret into v_webhook_secret
  from vault.decrypted_secrets where name='facts_pluggy_webhook_secret';
  select decrypted_secret into v_cron_secret
  from vault.decrypted_secrets where name='facts_bank_cron_secret';

  if v_client_id is null or v_client_secret is null or v_webhook_secret is null or v_cron_secret is null then
    raise exception 'FACTS_BANK_SECRET_MISSING' using errcode='22023';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', r.id,
    'ownerId', r.owner_id,
    'dependentId', r.dependent_id,
    'canonicalName', r.canonical_name,
    'normalizedName', r.normalized_name,
    'pensionAmountCents', r.pension_amount_cents,
    'pensionDayStart', r.pension_day_start,
    'pensionDayEnd', r.pension_day_end,
    'importFrom', r.import_from
  ) order by r.created_at), '[]'::jsonb)
  into v_rules
  from public.facts_bank_recipient_rules r
  where r.enabled;

  select coalesce(jsonb_agg(jsonb_build_object(
    'ownerId', c.owner_id,
    'provider', c.provider,
    'itemId', c.item_id,
    'status', c.status,
    'institution', c.institution,
    'lastSyncedAt', c.last_synced_at,
    'lastDataThrough', c.last_data_through
  ) order by c.created_at), '[]'::jsonb)
  into v_connections
  from public.facts_bank_connections c
  where c.provider='pluggy' and c.status='active';

  return jsonb_build_object(
    'clientId', v_client_id,
    'clientSecret', v_client_secret,
    'webhookSecret', v_webhook_secret,
    'cronSecret', v_cron_secret,
    'rules', v_rules,
    'connections', v_connections
  );
end;
$$;

revoke all on function public.facts_bank_runtime_config() from public, anon, authenticated;
grant execute on function public.facts_bank_runtime_config() to service_role;

create or replace function public.facts_import_bank_transaction(
  p_owner_id uuid,
  p_dependent_id uuid,
  p_provider_transaction_id text,
  p_item_id text,
  p_account_id text,
  p_occurred_at date,
  p_amount_cents bigint,
  p_original_amount_cents bigint,
  p_description text,
  p_tx_type text,
  p_operation_type text,
  p_tx_status text,
  p_payment_method text,
  p_counterparty_name text,
  p_match_source text,
  p_transfer_purpose text,
  p_source_detail text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_bank public.facts_bank_transactions%rowtype;
  v_candidates uuid[];
  v_fact_id uuid;
  v_mutation_id uuid;
  v_fact public.facts%rowtype;
  v_title text;
  v_notes text;
  v_result jsonb;
  v_month_names text[] := array[
    'Janeiro','Fevereiro','Março','Abril','Maio','Junho',
    'Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'
  ];
begin
  if current_user <> 'service_role' then
    raise exception 'FACTS_BANK_SERVICE_ROLE_REQUIRED' using errcode='42501';
  end if;
  if p_owner_id is null or p_dependent_id is null then
    raise exception 'FACTS_BANK_OWNER_REQUIRED' using errcode='22023';
  end if;
  if p_amount_cents is null or p_amount_cents < 1 then
    raise exception 'FACTS_BANK_AMOUNT_INVALID' using errcode='22023';
  end if;
  if p_transfer_purpose not in ('pensao','adicional','reembolso') then
    raise exception 'FACTS_BANK_PURPOSE_INVALID' using errcode='22023';
  end if;
  if p_match_source not in ('receiver','description') then
    raise exception 'FACTS_BANK_MATCH_SOURCE_INVALID' using errcode='22023';
  end if;
  if not exists (
    select 1 from public.facts_dependents d
    where d.owner_id=p_owner_id and d.id=p_dependent_id
  ) then
    raise exception 'FACTS_DEPENDENT_NOT_FOUND' using errcode='P0002';
  end if;

  insert into public.facts_bank_transactions(
    owner_id, provider, provider_transaction_id, item_id, account_id,
    occurred_at, amount_cents, original_amount_cents, direction, description,
    tx_type, operation_type, tx_status, payment_method, counterparty_name,
    match_source, classification, sync_state, first_seen_at, last_seen_at
  ) values (
    p_owner_id, 'pluggy', p_provider_transaction_id, p_item_id, p_account_id,
    p_occurred_at, p_amount_cents, p_original_amount_cents, 'outgoing', left(p_description,2000),
    left(p_tx_type,100), left(p_operation_type,100), left(p_tx_status,100), left(p_payment_method,100),
    left(p_counterparty_name,200), p_match_source, p_transfer_purpose, 'seen', now(), now()
  )
  on conflict(owner_id, provider, provider_transaction_id) do update set
    item_id=excluded.item_id,
    account_id=excluded.account_id,
    last_seen_at=now()
  returning * into v_bank;

  select * into v_bank
  from public.facts_bank_transactions
  where owner_id=p_owner_id and provider='pluggy' and provider_transaction_id=p_provider_transaction_id
  for update;

  if v_bank.fact_id is not null then
    return jsonb_build_object(
      'status', v_bank.sync_state,
      'bankTransactionId', v_bank.id,
      'factId', v_bank.fact_id,
      'replayed', true
    );
  end if;

  if v_bank.occurred_at <> p_occurred_at
    or v_bank.amount_cents <> p_amount_cents
    or v_bank.direction <> 'outgoing'
    or coalesce(v_bank.classification,'') <> p_transfer_purpose then
    update public.facts_bank_transactions
    set sync_state='needs_review', last_seen_at=now()
    where id=v_bank.id;
    return jsonb_build_object(
      'status','needs_review',
      'bankTransactionId',v_bank.id,
      'reason','provider_transaction_changed'
    );
  end if;

  select coalesce(array_agg(f.id order by f.created_at), array[]::uuid[])
  into v_candidates
  from public.facts f
  where f.owner_id=p_owner_id
    and f.dependent_id=p_dependent_id
    and f.kind='transfer'
    and f.occurred_at=p_occurred_at
    and f.amount_cents=p_amount_cents
    and (
      (p_counterparty_name is not null and lower(f.notes) like '%' || lower(p_counterparty_name) || '%')
      or (p_transfer_purpose='pensao' and f.transfer_purpose='pensao')
    );

  if cardinality(v_candidates)=1 then
    v_fact_id:=v_candidates[1];
    update public.facts_bank_transactions
    set fact_id=v_fact_id, classification=p_transfer_purpose, sync_state='linked_existing', last_seen_at=now()
    where id=v_bank.id;
    return jsonb_build_object(
      'status','linked_existing',
      'bankTransactionId',v_bank.id,
      'factId',v_fact_id,
      'replayed',false
    );
  elsif cardinality(v_candidates)>1 then
    update public.facts_bank_transactions
    set classification=p_transfer_purpose, sync_state='needs_review', last_seen_at=now()
    where id=v_bank.id;
    return jsonb_build_object(
      'status','needs_review',
      'bankTransactionId',v_bank.id,
      'reason','ambiguous_existing_fact'
    );
  end if;

  v_fact_id:=gen_random_uuid();
  v_mutation_id:=gen_random_uuid();

  if p_transfer_purpose='pensao' then
    v_title:='Pensão alimentícia — ' || v_month_names[extract(month from p_occurred_at)::int] || ' ' || extract(year from p_occurred_at)::int;
  else
    v_title:='Transferência para ' || coalesce(nullif(btrim(p_counterparty_name),''),'destinatário') || ' — ' || to_char(p_occurred_at,'DD/MM/YYYY');
  end if;

  v_notes:=concat(
    'Importado automaticamente da Pluggy. ',
    case when p_description is not null and btrim(p_description)<>'' then 'Descrição: ' || p_description || '. ' else '' end,
    'ID da transação Pluggy: ', p_provider_transaction_id, '.'
  );

  insert into public.facts_mutations(
    owner_id, mutation_id, source, created_by, created_at, operation, entity_type,
    entity_id, request_payload, result_payload, completed_at
  ) values (
    p_owner_id, v_mutation_id, 'import', 'assistant', now(), 'import_bank_transaction', 'fact',
    v_fact_id,
    jsonb_build_object(
      'provider','pluggy',
      'providerTransactionId',p_provider_transaction_id,
      'dependentId',p_dependent_id,
      'amountCents',p_amount_cents,
      'occurredAt',p_occurred_at,
      'transferPurpose',p_transfer_purpose
    ),
    null,
    null
  );

  insert into public.facts(
    id, owner_id, dependent_id, kind, title, category, notes, occurred_at,
    amount_cents, transfer_purpose, request_total_cents, source, source_detail,
    created_by, provenance_kind, created_at, updated_at
  ) values (
    v_fact_id, p_owner_id, p_dependent_id, 'transfer', v_title, 'outros', left(v_notes,10000), p_occurred_at,
    p_amount_cents, p_transfer_purpose, null, 'import', left(p_source_detail,100),
    'assistant', 'imported', now(), now()
  )
  returning * into v_fact;

  v_result:=to_jsonb(v_fact)-'owner_id';

  insert into public.facts_audit_entries(
    id, owner_id, mutation_id, entity_type, entity_id, action, source,
    created_by, changed_at, before_state, after_state
  ) values (
    gen_random_uuid(), p_owner_id, v_mutation_id, 'fact', v_fact_id, 'create', 'import',
    'assistant', now(), null, v_result
  );

  update public.facts_mutations
  set result_payload=v_result, completed_at=now()
  where owner_id=p_owner_id and mutation_id=v_mutation_id;

  update public.facts_bank_transactions
  set fact_id=v_fact_id, classification=p_transfer_purpose, sync_state='imported', last_seen_at=now()
  where id=v_bank.id;

  return jsonb_build_object(
    'status','imported',
    'bankTransactionId',v_bank.id,
    'factId',v_fact_id,
    'replayed',false
  );
end;
$$;

revoke all on function public.facts_import_bank_transaction(
  uuid,uuid,text,text,text,date,bigint,bigint,text,text,text,text,text,text,text,text,text
) from public, anon, authenticated;
grant execute on function public.facts_import_bank_transaction(
  uuid,uuid,text,text,text,date,bigint,bigint,text,text,text,text,text,text,text,text,text
) to service_role;
