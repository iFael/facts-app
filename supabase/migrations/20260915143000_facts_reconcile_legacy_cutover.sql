-- Reconciliação final do legado após o cutover do Web para o modelo relacional.
-- Só processa owners cujo snapshot avançou desde a primeira migração.
-- Fail-closed se o modelo relacional desses owners recebeu mutações auditadas após a migração inicial.

create temporary table facts_reconcile_latest on commit drop as
select distinct on (s.owner_id)
 s.owner_id,s.revision,s.document,s.created_at,m.snapshot_revision,m.migrated_at
from public.facts_snapshots s
join public.facts_legacy_migrations m on m.owner_id=s.owner_id
where s.revision>m.snapshot_revision
order by s.owner_id,s.revision desc;

-- Não sobrescrever alterações relacionais posteriores à migração inicial.
do $$
begin
 if exists (
  select 1
  from facts_reconcile_latest l
  join public.facts_audit_entries a on a.owner_id=l.owner_id and a.changed_at>l.migrated_at
 ) then
  raise exception 'FACTS_LEGACY_RECONCILE_RELATIONAL_CHANGES_DETECTED';
 end if;
end;
$$;

-- Remover apenas entidades que pertenciam ao snapshot anteriormente migrado.
create temporary table facts_reconcile_old_records on commit drop as
select m.owner_id,(r->>'id')::uuid id
from public.facts_legacy_migrations m
join facts_reconcile_latest l on l.owner_id=m.owner_id
join public.facts_snapshots s on s.owner_id=m.owner_id and s.revision=m.snapshot_revision
cross join lateral jsonb_array_elements(s.document->'records') r;

create temporary table facts_reconcile_old_attachments on commit drop as
select m.owner_id,(a->>'id')::uuid id
from public.facts_legacy_migrations m
join facts_reconcile_latest l on l.owner_id=m.owner_id
join public.facts_snapshots s on s.owner_id=m.owner_id and s.revision=m.snapshot_revision
cross join lateral jsonb_array_elements(s.document->'attachments') a;

delete from public.facts_relationships r
using facts_reconcile_old_records o
where r.owner_id=o.owner_id and (r.fact_id=o.id or r.request_id=o.id);

delete from public.facts_evidence_links l
using facts_reconcile_old_attachments o
where l.owner_id=o.owner_id and l.evidence_id=o.id;

delete from public.facts_evidence e
using facts_reconcile_old_attachments o
where e.owner_id=o.owner_id and e.id=o.id;

delete from public.facts_attachments a
using facts_reconcile_old_attachments o
where a.owner_id=o.owner_id and a.id=o.id;

delete from public.facts f
using facts_reconcile_old_records o
where f.owner_id=o.owner_id and f.id=o.id;

-- Dependente legado usa id determinístico = owner_id; atualizar in-place para não quebrar novos fatos.
insert into public.facts_dependents(id,owner_id,name,birth_date,created_at,updated_at)
select
 l.owner_id,l.owner_id,btrim(l.document#>>'{dependent,name}'),nullif(l.document#>>'{dependent,birthDate}','')::date,
 coalesce((select d.created_at from public.facts_dependents d where d.owner_id=l.owner_id and d.id=l.owner_id),l.created_at),l.created_at
from facts_reconcile_latest l
where l.document->'dependent' is not null and l.document->'dependent'<>'null'::jsonb
on conflict(id) do update set name=excluded.name,birth_date=excluded.birth_date,updated_at=excluded.updated_at;

insert into public.facts(
 id,owner_id,dependent_id,kind,title,category,notes,occurred_at,amount_cents,
 transfer_purpose,request_total_cents,source,source_detail,created_by,provenance_kind,created_at,updated_at
)
select
 (r->>'id')::uuid,l.owner_id,l.owner_id,r->>'kind',btrim(r->>'title'),r->>'category',coalesce(r->>'notes',''),
 (r->>'date')::date,nullif(r->>'amountCents','')::bigint,nullif(r->>'transferPurpose',''),nullif(r->>'requestTotalCents','')::bigint,
 'import',nullif(btrim(r->>'source'),''),'user','imported',(r->>'createdAt')::timestamptz,(r->>'updatedAt')::timestamptz
from facts_reconcile_latest l
cross join lateral jsonb_array_elements(l.document->'records') r;

insert into public.facts_attachments(id,owner_id,name,mime,size,sha256,created_at)
select (a->>'id')::uuid,l.owner_id,a->>'name',a->>'mime',(a->>'size')::bigint,a->>'sha256',l.created_at
from facts_reconcile_latest l
cross join lateral jsonb_array_elements(l.document->'attachments') a;

insert into public.facts_evidence(id,owner_id,attachment_id,source,extracted_text,interpretation,created_at)
select (a->>'id')::uuid,l.owner_id,(a->>'id')::uuid,'import',null,null,l.created_at
from facts_reconcile_latest l
cross join lateral jsonb_array_elements(l.document->'attachments') a;

insert into public.facts_evidence_links(owner_id,evidence_id,fact_id,created_at)
select l.owner_id,attachment_id::uuid,(r->>'id')::uuid,(r->>'createdAt')::timestamptz
from facts_reconcile_latest l
cross join lateral jsonb_array_elements(l.document->'records') r
cross join lateral jsonb_array_elements_text(coalesce(r->'attachmentIds','[]'::jsonb)) attachment_id;

insert into public.facts_relationships(id,owner_id,kind,fact_id,request_id,created_at)
select (r->>'id')::uuid,l.owner_id,'fulfills_request',(r->>'id')::uuid,(r->>'requestId')::uuid,(r->>'createdAt')::timestamptz
from facts_reconcile_latest l
cross join lateral jsonb_array_elements(l.document->'records') r
where nullif(r->>'requestId','') is not null;

update public.facts_legacy_migrations m
set snapshot_revision=l.revision,
    fact_count=jsonb_array_length(l.document->'records'),
    attachment_count=jsonb_array_length(l.document->'attachments'),
    migrated_at=now()
from facts_reconcile_latest l
where m.owner_id=l.owner_id;

-- Validação por IDs e total monetário do snapshot final; dados relacionais não-legados podem coexistir.
do $$
begin
 if exists (
  select 1 from facts_reconcile_latest l
  where (select count(*) from jsonb_array_elements(l.document->'records') r
         join public.facts f on f.owner_id=l.owner_id and f.id=(r->>'id')::uuid)<>jsonb_array_length(l.document->'records')
     or (select count(*) from jsonb_array_elements(l.document->'attachments') a
         join public.facts_attachments x on x.owner_id=l.owner_id and x.id=(a->>'id')::uuid)<>jsonb_array_length(l.document->'attachments')
     or (select coalesce(sum(f.amount_cents),0)
         from public.facts f
         where f.owner_id=l.owner_id and f.id in (select (r->>'id')::uuid from jsonb_array_elements(l.document->'records') r))<>
        (select coalesce(sum(nullif(r->>'amountCents','')::bigint),0) from jsonb_array_elements(l.document->'records') r)
 ) then
  raise exception 'FACTS_LEGACY_RECONCILE_MISMATCH';
 end if;
end;
$$;
