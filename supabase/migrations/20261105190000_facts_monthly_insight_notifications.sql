
create table if not exists public.facts_bank_insight_notifications (
 id uuid primary key default gen_random_uuid(),
 owner_id uuid not null references auth.users(id) on delete cascade,
 period_month date not null,
 category text not null check(category in ('alimentacao','saude','vestuario','transporte','higiene','educacao','lazer','outros')),
 previous_cents bigint not null check(previous_cents>=5000),
 current_cents bigint not null check(current_cents>previous_cents),
 status text not null default 'pending' check(status in ('pending','sending','sent','failed')),
 attempts integer not null default 0 check(attempts between 0 and 20),
 last_error_code text,
 sent_at timestamptz,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(owner_id,period_month,category)
);
alter table public.facts_bank_insight_notifications enable row level security;
revoke all on public.facts_bank_insight_notifications from public,anon,authenticated;

create or replace function public.facts_queue_monthly_insights(p_owner uuid,p_month date)
returns integer language plpgsql security definer set search_path='' as $$
declare
 v_start date:=date_trunc('month',p_month)::date;
 v_last date:=(date_trunc('month',p_month)-interval '1 month')::date;
 v_count integer;
begin
 if not exists(select 1 from public.facts_bank_settings where owner_id=p_owner)
 then raise exception 'FACTS_BANK_OWNER_NOT_CONFIGURED'; end if;
 if v_start>=date_trunc('month',current_date)::date then return 0; end if;
 with prev as(
  select category,sum(amount_cents)::bigint total
  from public.facts where owner_id=p_owner and kind in ('expense','payment')
   and occurred_at>=v_last and occurred_at<v_start
  group by category
 ), cur as(
  select category,sum(amount_cents)::bigint total
  from public.facts where owner_id=p_owner and kind in ('expense','payment')
   and occurred_at>=v_start and occurred_at<(v_start+interval '1 month')::date
  group by category
 ), inserted as(
  insert into public.facts_bank_insight_notifications(owner_id,period_month,category,previous_cents,current_cents)
  select p_owner,v_start,cur.category,prev.total,cur.total
  from cur join prev on prev.category=cur.category
  where prev.total>=5000 and cur.total-prev.total>=5000 and cur.total::numeric>=prev.total::numeric*1.30
  on conflict(owner_id,period_month,category) do nothing
  returning id
 )
 select count(*) into v_count from inserted;
 return v_count;
end $$;
revoke all on function public.facts_queue_monthly_insights(uuid,date) from public,anon,authenticated;
grant execute on function public.facts_queue_monthly_insights(uuid,date) to service_role;

create or replace function public.facts_claim_monthly_insights(p_limit integer default 10)
returns setof public.facts_bank_insight_notifications language plpgsql security definer set search_path='' as $$
begin
 return query with claimed as(
  select id from public.facts_bank_insight_notifications
  where (status in ('pending','failed') or (status='sending' and updated_at<now()-interval '10 minutes'))
   and attempts<5
  order by created_at,id for update skip locked
  limit least(greatest(coalesce(p_limit,10),1),20)
 )
 update public.facts_bank_insight_notifications n
 set status='sending',attempts=n.attempts+1,updated_at=now()
 from claimed where n.id=claimed.id returning n.*;
end $$;
revoke all on function public.facts_claim_monthly_insights(integer) from public,anon,authenticated;
grant execute on function public.facts_claim_monthly_insights(integer) to service_role;
