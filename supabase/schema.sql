create table public.facts_snapshots (
 owner_id uuid not null references auth.users(id) on delete cascade,
 revision bigint not null check (revision > 0),
 mutation_id uuid not null,
 document jsonb not null check (document->>'formatVersion' = '1' and jsonb_typeof(document->'records')='array' and jsonb_typeof(document->'attachments')='array'),
 created_at timestamptz not null default now(),
 primary key(owner_id,revision), unique(owner_id,mutation_id)
);
alter table public.facts_snapshots enable row level security;
revoke all on public.facts_snapshots from anon;
grant select,insert,delete on public.facts_snapshots to authenticated;
create policy facts_owner_read on public.facts_snapshots for select to authenticated using ((select auth.uid())=owner_id);
create policy facts_owner_insert on public.facts_snapshots for insert to authenticated with check ((select auth.uid())=owner_id);
create policy facts_owner_retention on public.facts_snapshots for delete to authenticated using ((select auth.uid())=owner_id);

create function public.facts_save(p_document jsonb,p_expected_revision bigint,p_mutation_id uuid)
returns bigint language plpgsql security invoker set search_path='' as $$
declare v_user uuid:=auth.uid(); v_current bigint; v_existing bigint;
begin
 if v_user is null then raise exception 'Autenticação necessária' using errcode='42501'; end if;
 if p_document is null or p_mutation_id is null or p_expected_revision is null or p_expected_revision<0 then raise exception 'Entrada inválida'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_user::text,0));
 select revision into v_existing from public.facts_snapshots where owner_id=v_user and mutation_id=p_mutation_id;
 if v_existing is not null then return v_existing; end if;
 select coalesce(max(revision),0) into v_current from public.facts_snapshots where owner_id=v_user;
 if v_current<>p_expected_revision then raise exception 'FACTS_CONFLICT' using errcode='40001'; end if;
 insert into public.facts_snapshots(owner_id,revision,mutation_id,document) values(v_user,v_current+1,p_mutation_id,p_document);
 delete from public.facts_snapshots where owner_id=v_user and revision<=v_current+1-20;
 return v_current+1;
end;
$$;
revoke all on function public.facts_save(jsonb,bigint,uuid) from public,anon;
grant execute on function public.facts_save(jsonb,bigint,uuid) to authenticated;

insert into storage.buckets(id,name,public,file_size_limit)
 values('facts-attachments','facts-attachments',false,20971520);
create policy facts_files_read on storage.objects for select to authenticated
 using(bucket_id='facts-attachments' and (storage.foldername(name))[1]=(select auth.uid())::text);
create policy facts_files_insert on storage.objects for insert to authenticated
 with check(bucket_id='facts-attachments' and (storage.foldername(name))[1]=(select auth.uid())::text);
create policy facts_files_update on storage.objects for update to authenticated
 using(bucket_id='facts-attachments' and (storage.foldername(name))[1]=(select auth.uid())::text)
 with check(bucket_id='facts-attachments' and (storage.foldername(name))[1]=(select auth.uid())::text);
