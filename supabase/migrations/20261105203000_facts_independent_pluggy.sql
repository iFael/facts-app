
create table if not exists public.facts_pluggy_connections (
  owner_id uuid not null references auth.users(id) on delete cascade,
  item_id uuid not null,
  institution text,
  status text not null default 'active' check (status in ('active','error','removed','expired')),
  last_synced_at timestamptz,
  last_error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (owner_id,item_id)
);
create index if not exists facts_pluggy_connections_active_idx
 on public.facts_pluggy_connections(owner_id,status) where status='active';
alter table public.facts_pluggy_connections enable row level security;
revoke all on public.facts_pluggy_connections from public,anon,authenticated;
grant select on public.facts_pluggy_connections to authenticated;
drop policy if exists facts_pluggy_connections_owner_read on public.facts_pluggy_connections;
create policy facts_pluggy_connections_owner_read on public.facts_pluggy_connections
for select to authenticated using(owner_id=(select auth.uid()));

create or replace function public.facts_pluggy_runtime_config()
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_client_id text;v_client_secret text;v_webhook_secret text;v_cron text;
 v_email_key text;v_email_to text;v_email_from text;v_settings jsonb;v_rules jsonb;v_learning jsonb;v_connections jsonb;
begin
 select decrypted_secret into v_client_id from vault.decrypted_secrets where name='facts_pluggy_client_id';
 select decrypted_secret into v_client_secret from vault.decrypted_secrets where name='facts_pluggy_client_secret';
 select decrypted_secret into v_webhook_secret from vault.decrypted_secrets where name='facts_pluggy_webhook_secret';
 select decrypted_secret into v_cron from vault.decrypted_secrets where name='facts_bank_cron_secret';
 select decrypted_secret into v_email_key from vault.decrypted_secrets where name='facts_resend_api_key';
 select decrypted_secret into v_email_to from vault.decrypted_secrets where name='facts_notification_email';
 select decrypted_secret into v_email_from from vault.decrypted_secrets where name='facts_notification_from';
 if v_cron is null or v_webhook_secret is null then raise exception 'FACTS_BANK_SECRETS_REQUIRED'; end if;

 select coalesce(jsonb_agg(jsonb_build_object(
  'ownerId',s.owner_id,'dependentId',s.dependent_id,'ledgerFrom',s.ledger_from,
  'notifyFrom',s.notify_from,'lastSyncedAt',s.last_synced_at)),'[]'::jsonb)
 into v_settings from public.facts_bank_settings s;
 select coalesce(jsonb_agg(jsonb_build_object(
  'ownerId',r.owner_id,'dependentId',r.dependent_id,'canonicalName',r.canonical_name,
  'normalizedName',r.normalized_name,'pensionAmountCents',r.pension_amount_cents,
  'pensionDayStart',r.pension_day_start,'pensionDayEnd',r.pension_day_end,
  'importFrom',r.import_from)),'[]'::jsonb)
 into v_rules from public.facts_bank_recipient_rules r where r.enabled;
 select coalesce(jsonb_agg(jsonb_build_object(
  'ownerId',r.owner_id,'dependentId',r.dependent_id,'matchKind',r.match_kind,
  'matchValue',r.match_value,'direction',r.direction,'action',r.action,'category',r.category)),'[]'::jsonb)
 into v_learning from public.facts_bank_learning_rules r where r.enabled;
 select coalesce(jsonb_agg(jsonb_build_object(
  'ownerId',c.owner_id,'itemId',c.item_id,'institution',c.institution,
  'status',c.status,'lastSyncedAt',c.last_synced_at)),'[]'::jsonb)
 into v_connections from public.facts_pluggy_connections c where c.status='active';
 return jsonb_build_object(
  'clientId',v_client_id,'clientSecret',v_client_secret,'webhookSecret',v_webhook_secret,
  'cronSecret',v_cron,'emailKey',v_email_key,'emailTo',v_email_to,'emailFrom',v_email_from,
  'settings',v_settings,'rules',v_rules,'learningRules',v_learning,'connections',v_connections
 );
end
$$;
revoke all on function public.facts_pluggy_runtime_config() from public,anon,authenticated;
grant execute on function public.facts_pluggy_runtime_config() to service_role;
do $$
begin
 if not exists(select 1 from vault.secrets where name='facts_pluggy_webhook_secret') then
   perform vault.create_secret(encode(extensions.gen_random_bytes(32),'hex'),
       'facts_pluggy_webhook_secret','Independent webhook verification secret for Facts Pluggy');
 end if;
end $$;
