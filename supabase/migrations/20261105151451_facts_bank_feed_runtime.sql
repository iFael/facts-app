create or replace function public.facts_bank_runtime_config()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_feed_token text;
  v_cron_secret text;
  v_rules jsonb;
begin
  if current_user <> 'service_role' then
    raise exception 'FACTS_BANK_SERVICE_ROLE_REQUIRED' using errcode='42501';
  end if;

  select decrypted_secret into v_feed_token
  from vault.decrypted_secrets where name='facts_bank_feed_token';
  select decrypted_secret into v_cron_secret
  from vault.decrypted_secrets where name='facts_bank_cron_secret';

  if v_feed_token is null or v_cron_secret is null then
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

  return jsonb_build_object(
    'feedToken', v_feed_token,
    'cronSecret', v_cron_secret,
    'rules', v_rules
  );
end;
$$;

revoke all on function public.facts_bank_runtime_config() from public, anon, authenticated;
grant execute on function public.facts_bank_runtime_config() to service_role;
