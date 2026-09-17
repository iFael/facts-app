-- Migração aditiva do último snapshot legado de cada owner para o modelo relacional.
-- Não remove nem altera facts_snapshots ou objetos existentes no Storage.

create table public.facts_legacy_migrations (
 owner_id uuid primary key references auth.users(id) on delete cascade,
 snapshot_revision bigint not null,
 fact_count integer not null check (fact_count>=0),
 attachment_count integer not null check (attachment_count>=0),
 migrated_at timestamptz not null default now()
);
alter table public.facts_legacy_migrations enable row level security;
revoke all on public.facts_legacy_migrations from public,anon;
grant select on public.facts_legacy_migrations to authenticated;
create policy facts_legacy_migrations_owner_read on public.facts_legacy_migrations for select to authenticated
 using ((select auth.uid())=owner_id);

create temporary table facts_migration_latest on commit drop as
select distinct on (owner_id) owner_id,revision,mutation_id,document,created_at
from public.facts_snapshots
order by owner_id,revision desc;

-- Fail closed: esta migration só opera owners cujo destino relacional ainda está vazio.
do $$
begin
 if exists (
  select 1 from facts_migration_latest l
  where exists(select 1 from public.facts_dependents d where d.owner_id=l.owner_id)
     or exists(select 1 from public.facts f where f.owner_id=l.owner_id)
     or exists(select 1 from public.facts_attachments a where a.owner_id=l.owner_id)
     or exists(select 1 from public.facts_evidence e where e.owner_id=l.owner_id)
     or exists(select 1 from public.facts_relationships r where r.owner_id=l.owner_id)
 ) then
  raise exception 'FACTS_LEGACY_MIGRATION_TARGET_NOT_EMPTY';
 end if;
end;
$$;

insert into public.facts_dependents(id,owner_id,name,birth_date,created_at,updated_at)
select
 l.owner_id,l.owner_id,btrim(l.document#>>'{dependent,name}'),
 nullif(l.document#>>'{dependent,birthDate}','')::date,
 (select min(s.created_at) from public.facts_snapshots s where s.owner_id=l.owner_id),
 l.created_at
from facts_migration_latest l
where l.document->'dependent' is not null and l.document->'dependent'<>'null'::jsonb;

insert into public.facts(
 id,owner_id,dependent_id,kind,title,category,notes,occurred_at,amount_cents,
 transfer_purpose,request_total_cents,source,source_detail,created_by,provenance_kind,created_at,updated_at
)
select
 (r->>'id')::uuid,l.owner_id,l.owner_id,r->>'kind',btrim(r->>'title'),r->>'category',coalesce(r->>'notes',''),
 (r->>'date')::date,nullif(r->>'amountCents','')::bigint,
 nullif(r->>'transferPurpose',''),nullif(r->>'requestTotalCents','')::bigint,
 'import',nullif(btrim(r->>'source'),''),'user','imported',
 (r->>'createdAt')::timestamptz,(r->>'updatedAt')::timestamptz
from facts_migration_latest l
cross join lateral jsonb_array_elements(l.document->'records') r;

insert into public.facts_attachments(id,owner_id,name,mime,size,sha256,created_at)
select
 (a->>'id')::uuid,l.owner_id,a->>'name',a->>'mime',(a->>'size')::bigint,a->>'sha256',l.created_at
from facts_migration_latest l
cross join lateral jsonb_array_elements(l.document->'attachments') a;

-- Um Evidence importado por arquivo legado. O arquivo original continua no mesmo objeto privado do Storage.
insert into public.facts_evidence(id,owner_id,attachment_id,source,extracted_text,interpretation,created_at)
select (a->>'id')::uuid,l.owner_id,(a->>'id')::uuid,'import',null,null,l.created_at
from facts_migration_latest l
cross join lateral jsonb_array_elements(l.document->'attachments') a;

insert into public.facts_evidence_links(owner_id,evidence_id,fact_id,created_at)
select l.owner_id,attachment_id::uuid,(r->>'id')::uuid,(r->>'createdAt')::timestamptz
from facts_migration_latest l
cross join lateral jsonb_array_elements(l.document->'records') r
cross join lateral jsonb_array_elements_text(coalesce(r->'attachmentIds','[]'::jsonb)) attachment_id;

-- Cada desembolso legado tinha no máximo um requestId; usar o próprio fact id torna o relacionamento determinístico.
insert into public.facts_relationships(id,owner_id,kind,fact_id,request_id,created_at)
select (r->>'id')::uuid,l.owner_id,'fulfills_request',(r->>'id')::uuid,(r->>'requestId')::uuid,(r->>'createdAt')::timestamptz
from facts_migration_latest l
cross join lateral jsonb_array_elements(l.document->'records') r
where nullif(r->>'requestId','') is not null;

insert into public.facts_legacy_migrations(owner_id,snapshot_revision,fact_count,attachment_count)
select l.owner_id,l.revision,jsonb_array_length(l.document->'records'),jsonb_array_length(l.document->'attachments')
from facts_migration_latest l;

-- Verificação estrutural e monetária. Qualquer divergência aborta a migration inteira.
do $$
declare v_bad boolean;
begin
 select exists(
  select 1 from facts_migration_latest l
  where (select count(*) from public.facts_dependents d where d.owner_id=l.owner_id)
        <> case when l.document->'dependent' is null or l.document->'dependent'='null'::jsonb then 0 else 1 end
     or (select count(*) from public.facts f where f.owner_id=l.owner_id)<>jsonb_array_length(l.document->'records')
     or (select count(*) from public.facts_attachments a where a.owner_id=l.owner_id)<>jsonb_array_length(l.document->'attachments')
     or (select count(*) from public.facts_evidence e where e.owner_id=l.owner_id)<>jsonb_array_length(l.document->'attachments')
     or (select count(*) from public.facts_relationships r where r.owner_id=l.owner_id)<>
        (select count(*) from jsonb_array_elements(l.document->'records') x where nullif(x->>'requestId','') is not null)
     or (select coalesce(sum(f.amount_cents),0) from public.facts f where f.owner_id=l.owner_id)<>
        (select coalesce(sum(nullif(x->>'amountCents','')::bigint),0) from jsonb_array_elements(l.document->'records') x)
 ) into v_bad;
 if v_bad then raise exception 'FACTS_LEGACY_MIGRATION_COUNT_OR_TOTAL_MISMATCH'; end if;

 if exists(
  select 1 from facts_migration_latest l
  cross join lateral jsonb_array_elements(l.document->'records') r
  left join public.facts f on f.owner_id=l.owner_id and f.id=(r->>'id')::uuid
  where f.id is null
     or f.kind<>(r->>'kind')
     or f.title<>btrim(r->>'title')
     or f.category<>(r->>'category')
     or f.notes<>coalesce(r->>'notes','')
     or f.occurred_at<>(r->>'date')::date
     or f.amount_cents is distinct from nullif(r->>'amountCents','')::bigint
     or f.transfer_purpose is distinct from nullif(r->>'transferPurpose','')
     or f.request_total_cents is distinct from nullif(r->>'requestTotalCents','')::bigint
     or f.source<>'import' or f.source_detail is distinct from nullif(btrim(r->>'source'),'')
     or f.created_by<>'user' or f.provenance_kind<>'imported'
 ) then raise exception 'FACTS_LEGACY_MIGRATION_FACT_MISMATCH'; end if;

 if exists(
  select 1 from facts_migration_latest l
  cross join lateral jsonb_array_elements(l.document->'attachments') a
  left join public.facts_attachments x on x.owner_id=l.owner_id and x.id=(a->>'id')::uuid
  where x.id is null or x.name<>(a->>'name') or x.mime<>(a->>'mime') or x.size<>(a->>'size')::bigint or x.sha256<>(a->>'sha256')
 ) then raise exception 'FACTS_LEGACY_MIGRATION_ATTACHMENT_MISMATCH'; end if;
end;
$$;
