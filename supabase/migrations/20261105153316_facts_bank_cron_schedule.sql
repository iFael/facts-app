do $$
begin
  if exists(select 1 from cron.job where jobname='facts-bank-sync') then
    perform cron.unschedule('facts-bank-sync');
  end if;
end
$$;

select cron.schedule(
  'facts-bank-sync',
  '0 */4 * * *',
  $job$
    select net.http_post(
      url := 'https://gpbsjmagjxpnoooldgtk.supabase.co/functions/v1/bank-sync',
      headers := jsonb_build_object(
        'Content-Type','application/json',
        'x-facts-sync-secret',(select decrypted_secret from vault.decrypted_secrets where name='facts_bank_cron_secret')
      ),
      body := '{"trigger":"cron"}'::jsonb,
      timeout_milliseconds := 60000
    );
  $job$
);
