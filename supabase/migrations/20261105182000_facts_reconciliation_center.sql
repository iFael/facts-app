
-- Consolidates the partial, already-created private bank ledger tables.
alter table public.facts_bank_transactions
  add column if not exists institution text,
  add column if not exists category text,
  add column if not exists merchant_name text,
  add column if not exists counterparty_kind text,
  add column if not exists foreign_charge boolean not null default false,
  add column if not exists relevance text not null default 'unknown',
  add column if not exists relevance_confidence smallint not null default 0,
  add column if not exists competence_month date,
  add column if not exists updated_at timestamptz not null default now();

alter table public.facts_bank_transactions
  drop constraint if exists facts_bank_transactions_classification_check,
  drop constraint if exists facts_bank_transactions_sync_state_check;
alter table public.facts_bank_transactions
  drop constraint if exists facts_bank_transactions_relevance_check,
  drop constraint if exists facts_bank_transactions_relevance_confidence_check;
alter table public.facts_bank_transactions
  add constraint facts_bank_transactions_classification_check
    check (classification is null or classification in ('pensao','adicional','reembolso','noah_expense')),
  add constraint facts_bank_transactions_sync_state_check
    check (sync_state in ('seen','linked_existing','imported','needs_review','reviewed')),
  add constraint facts_bank_transactions_relevance_check
    check (relevance in ('unknown','agata','noah','irrelevant')),
  add constraint facts_bank_transactions_relevance_confidence_check
    check (relevance_confidence between 0 and 100);

create unique index if not exists facts_bank_transactions_owner_id_id_key on public.facts_bank_transactions(owner_id,id);
create index if not exists facts_bank_transactions_owner_date_idx on public.facts_bank_transactions(owner_id,occurred_at desc);
create index if not exists facts_bank_transactions_relevance_idx on public.facts_bank_transactions(owner_id,relevance,occurred_at desc);

create table if not exists public.facts_bank_settings (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  dependent_id uuid not null,
  ledger_from date not null,
  notify_from date not null,
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint facts_bank_settings_dependent_fk foreign key(owner_id,dependent_id)
    references public.facts_dependents(owner_id,id) on delete restrict
);
alter table public.facts_bank_settings add column if not exists last_synced_at timestamptz;
create table if not exists public.facts_bank_reviews (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  transaction_id uuid not null,
  dependent_id uuid not null,
  reason text not null check (reason in (
    'pension_outside_window','pension_duplicate_month','agata_outgoing_other',
    'agata_incoming','possible_noah_expense'
  )),
  status text not null default 'pending' check (status in ('pending','resolved','dismissed')),
  suggested_action text not null check (suggested_action in ('pensao','adicional','reembolso','noah_expense','ignore')),
  resolved_action text check (resolved_action is null or resolved_action in ('pensao','adicional','reembolso','noah_expense','ignore')),
  resolution_note text check (resolution_note is null or char_length(resolution_note)<=1000),
  competence_month date,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  unique(owner_id,transaction_id),
  constraint facts_bank_reviews_transaction_fk foreign key(owner_id,transaction_id)
    references public.facts_bank_transactions(owner_id,id) on delete cascade,
  constraint facts_bank_reviews_dependent_fk foreign key(owner_id,dependent_id)
    references public.facts_dependents(owner_id,id) on delete restrict
);
alter table public.facts_bank_reviews add column if not exists competence_month date;
create table if not exists public.facts_bank_notifications (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  transaction_id uuid not null,
  kind text not null check (kind in ('bank_event','bank_review')),
  status text not null default 'pending',
  attempts integer not null default 0 check (attempts between 0 and 20),
  last_error_code text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(owner_id,transaction_id,kind),
  constraint facts_bank_notifications_transaction_fk foreign key(owner_id,transaction_id)
    references public.facts_bank_transactions(owner_id,id) on delete cascade
);
alter table public.facts_bank_notifications drop constraint if exists facts_bank_notifications_status_check;
alter table public.facts_bank_notifications add constraint facts_bank_notifications_status_check
  check (status in ('pending','sending','sent','failed'));
create table if not exists public.facts_bank_learning_rules (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  dependent_id uuid not null,
  match_kind text not null check (match_kind in ('merchant','counterparty')),
  match_value text not null check (char_length(btrim(match_value)) between 1 and 300),
  direction text check (direction is null or direction in ('outgoing','incoming')),
  action text not null check (action in ('noah_expense','ignore')),
  category text,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(owner_id,match_kind,match_value,direction),
  constraint facts_bank_learning_rules_dependent_fk foreign key(owner_id,dependent_id)
    references public.facts_dependents(owner_id,id) on delete restrict
);
alter table public.facts_bank_recipient_rules add column if not exists notify_from date;

alter table public.facts_bank_transactions enable row level security;
alter table public.facts_bank_settings enable row level security;
alter table public.facts_bank_reviews enable row level security;
alter table public.facts_bank_notifications enable row level security;
alter table public.facts_bank_learning_rules enable row level security;
alter table public.facts_bank_recipient_rules enable row level security;
revoke all on public.facts_bank_transactions,public.facts_bank_settings,public.facts_bank_reviews,
  public.facts_bank_notifications,public.facts_bank_learning_rules,public.facts_bank_recipient_rules
  from public,anon,authenticated;
grant select on public.facts_bank_transactions,public.facts_bank_reviews,
  public.facts_bank_settings,public.facts_bank_learning_rules to authenticated;
drop policy if exists facts_bank_transactions_owner_select on public.facts_bank_transactions;
create policy facts_bank_transactions_owner_select on public.facts_bank_transactions
 for select to authenticated using (owner_id=(select auth.uid()));
drop policy if exists facts_bank_reviews_owner_select on public.facts_bank_reviews;
create policy facts_bank_reviews_owner_select on public.facts_bank_reviews
 for select to authenticated using (owner_id=(select auth.uid()));
drop policy if exists facts_bank_settings_owner_select on public.facts_bank_settings;
create policy facts_bank_settings_owner_select on public.facts_bank_settings
 for select to authenticated using (owner_id=(select auth.uid()));
drop policy if exists facts_bank_learning_rules_owner_select on public.facts_bank_learning_rules;
create policy facts_bank_learning_rules_owner_select on public.facts_bank_learning_rules
 for select to authenticated using (owner_id=(select auth.uid()));

insert into public.facts_bank_settings(owner_id,dependent_id,ledger_from,notify_from)
values(
 '2dcdda38-0d43-40de-b5dc-92582f2e87a3'::uuid,
 '2dcdda38-0d43-40de-b5dc-92582f2e87a3'::uuid,
 date '2025-10-27',date '2026-11-05'
)
on conflict(owner_id) do update set
 ledger_from=least(public.facts_bank_settings.ledger_from,excluded.ledger_from),
 notify_from=excluded.notify_from,updated_at=now();
update public.facts_bank_recipient_rules
set notify_from=coalesce(notify_from,date '2026-11-05')
where notify_from is null;
