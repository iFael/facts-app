-- Temporary, owner-isolated message transport between the hosted Facts UI and
-- the user's own Windows SIWC runtime. No OpenAI tokens enter the database.
create table if not exists public.facts_agent_presence (
 owner_id uuid primary key references auth.users(id) on delete cascade,
 last_seen_at timestamptz not null default now()
);
alter table public.facts_agent_presence enable row level security;
revoke all on public.facts_agent_presence from public,anon,authenticated;
grant select on public.facts_agent_presence to authenticated;
drop policy if exists facts_agent_presence_owner_read on public.facts_agent_presence;
create policy facts_agent_presence_owner_read on public.facts_agent_presence
 for select to authenticated using (owner_id=(select auth.uid()));

-- Only an authenticated user can announce their own local agent. Database time,
-- not client time, decides whether the agent is online.
create or replace function public.facts_agent_heartbeat()
returns timestamptz language plpgsql security definer set search_path='' as $$
declare v_owner uuid:=auth.uid();v_now timestamptz:=now();
begin
 if v_owner is null then raise exception 'FACTS_AGENT_UNAUTHORIZED';end if;
 insert into public.facts_agent_presence(owner_id,last_seen_at)
 values(v_owner,v_now)
 on conflict(owner_id) do update set last_seen_at=excluded.last_seen_at;
 return v_now;
end $$;
revoke all on function public.facts_agent_heartbeat() from public,anon;
grant execute on function public.facts_agent_heartbeat() to authenticated;

create table if not exists public.facts_agent_jobs (
 id uuid primary key default gen_random_uuid(),
 owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
 question text not null check (char_length(btrim(question)) between 1 and 1000),
 history jsonb not null default '[]'::jsonb check (
   jsonb_typeof(history)='array' and octet_length(history::text)<=11000
 ),
 status text not null default 'queued' check (status in ('queued','working','done','error')),
 reply text check(reply is null or char_length(reply)<=8000),
 coverage text check(coverage is null or coverage in ('complete','partial')),
 error_code text check(error_code is null or (char_length(error_code)<=80 and error_code ~ '^[a-z_]+$')),
 created_at timestamptz not null default now(),
 expires_at timestamptz not null default (now()+interval '3 minutes'),
 check (expires_at>created_at and expires_at<=created_at+interval '3 minutes')
);
create index if not exists facts_agent_jobs_owner_queue_idx
 on public.facts_agent_jobs(owner_id,created_at)
 where status='queued';
create index if not exists facts_agent_jobs_expiry_idx
 on public.facts_agent_jobs(expires_at);
alter table public.facts_agent_jobs enable row level security;
revoke all on public.facts_agent_jobs from public,anon,authenticated;
grant select,insert,update,delete on public.facts_agent_jobs to authenticated;
drop policy if exists facts_agent_jobs_owner_only on public.facts_agent_jobs;
create policy facts_agent_jobs_owner_only on public.facts_agent_jobs
 for all to authenticated
 using (owner_id=(select auth.uid()))
 with check (owner_id=(select auth.uid()));

-- The server expires transient message contents even when the Windows PC
-- remains off. A job is never a permanent financial record.
select cron.schedule('facts-agent-purge-expired','*/15 * * * *',
 $$delete from public.facts_agent_jobs where expires_at<now()$$);
