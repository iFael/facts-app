create table public.facts_dependents (
 id uuid primary key,
 owner_id uuid not null references auth.users(id) on delete cascade,
 name text not null check (char_length(btrim(name)) between 1 and 100),
 birth_date date,
 created_at timestamptz not null,
 updated_at timestamptz not null,
 unique(owner_id,id),
 check (updated_at>=created_at)
);

create table public.facts (
 id uuid primary key,
 owner_id uuid not null references auth.users(id) on delete cascade,
 dependent_id uuid not null,
 kind text not null check (kind in ('expense','payment','transfer','request','event')),
 title text not null check (char_length(btrim(title)) between 1 and 160),
 category text not null check (category in ('alimentacao','saude','vestuario','transporte','higiene','educacao','lazer','outros')),
 notes text not null default '' check (char_length(notes)<=10000),
 occurred_at date not null,
 amount_cents bigint,
 transfer_purpose text,
 request_total_cents bigint,
 source text not null check (source in ('chat','ui','document','import')),
 source_detail text check (source_detail is null or char_length(btrim(source_detail)) between 1 and 100),
 created_by text not null check (created_by in ('user','assistant')),
 provenance_kind text not null check (provenance_kind in ('user_assertion','assistant_interpretation','evidence_derived','imported')),
 created_at timestamptz not null,
 updated_at timestamptz not null,
 unique(owner_id,id),
 constraint facts_dependent_owner_fk foreign key(owner_id,dependent_id) references public.facts_dependents(owner_id,id) on delete restrict,
 constraint facts_amount_shape_check check (
  (kind='event' and amount_cents is null)
  or (kind in ('expense','payment','transfer','request') and amount_cents is not null and amount_cents between 1 and 99999999999)
 ),
 constraint facts_transfer_shape_check check (
  (kind='transfer' and transfer_purpose is not null and transfer_purpose in ('pensao','adicional','reembolso'))
  or (kind<>'transfer' and transfer_purpose is null)
 ),
 constraint facts_request_shape_check check (
  (kind='request' and (request_total_cents is null or request_total_cents between amount_cents and 99999999999))
  or (kind<>'request' and request_total_cents is null)
 ),
 check (updated_at>=created_at)
);

create table public.facts_attachments (
 id uuid primary key,
 owner_id uuid not null references auth.users(id) on delete cascade,
 name text not null check (char_length(btrim(name)) between 1 and 255),
 mime text not null check (char_length(btrim(mime)) between 1 and 150),
 size bigint not null check (size between 1 and 20971520),
 sha256 text not null check (sha256 ~ '^[a-f0-9]{64}$'),
 created_at timestamptz not null,
 unique(owner_id,id)
);

create table public.facts_evidence (
 id uuid primary key,
 owner_id uuid not null references auth.users(id) on delete cascade,
 attachment_id uuid not null,
 source text not null check (source in ('document','import')),
 extracted_text text check (extracted_text is null or char_length(extracted_text)<=1000000),
 interpretation jsonb check (interpretation is null or jsonb_typeof(interpretation)='object'),
 created_at timestamptz not null,
 unique(owner_id,id),
 constraint facts_evidence_attachment_owner_fk foreign key(owner_id,attachment_id) references public.facts_attachments(owner_id,id) on delete restrict
);

create table public.facts_evidence_links (
 owner_id uuid not null references auth.users(id) on delete cascade,
 evidence_id uuid not null,
 fact_id uuid not null,
 created_at timestamptz not null default now(),
 primary key(owner_id,evidence_id,fact_id),
 constraint facts_evidence_links_evidence_fk foreign key(owner_id,evidence_id) references public.facts_evidence(owner_id,id) on delete cascade,
 constraint facts_evidence_links_fact_fk foreign key(owner_id,fact_id) references public.facts(owner_id,id) on delete cascade
);

create table public.facts_relationships (
 id uuid primary key,
 owner_id uuid not null references auth.users(id) on delete cascade,
 kind text not null check (kind='fulfills_request'),
 fact_id uuid not null,
 request_id uuid not null,
 created_at timestamptz not null,
 unique(owner_id,id),
 unique(owner_id,kind,fact_id,request_id),
 constraint facts_relationships_distinct_check check (fact_id<>request_id),
 constraint facts_relationships_fact_fk foreign key(owner_id,fact_id) references public.facts(owner_id,id) on delete restrict,
 constraint facts_relationships_request_fk foreign key(owner_id,request_id) references public.facts(owner_id,id) on delete restrict
);

create table public.facts_mutations (
 owner_id uuid not null references auth.users(id) on delete cascade,
 mutation_id uuid not null,
 source text not null check (source in ('chat','ui','document','import')),
 created_by text not null check (created_by in ('user','assistant')),
 created_at timestamptz not null,
 primary key (owner_id,mutation_id)
);

create table public.facts_audit_entries (
 id uuid primary key,
 owner_id uuid not null references auth.users(id) on delete cascade,
 mutation_id uuid not null,
 entity_type text not null check (entity_type in ('dependent','fact','evidence','attachment','relationship')),
 entity_id uuid not null,
 action text not null check (action in ('create','update','delete','link','unlink')),
 source text not null check (source in ('chat','ui','document','import')),
 created_by text not null check (created_by in ('user','assistant')),
 changed_at timestamptz not null,
 before_state jsonb,
 after_state jsonb,
 constraint facts_audit_mutation_fk foreign key(owner_id,mutation_id) references public.facts_mutations(owner_id,mutation_id) on delete restrict,
 constraint facts_audit_state_check check (before_state is not null or after_state is not null)
);

create index facts_owner_occurred_idx on public.facts(owner_id,occurred_at desc,created_at desc);
create index facts_owner_kind_idx on public.facts(owner_id,kind,occurred_at desc);
create index facts_attachments_owner_sha_idx on public.facts_attachments(owner_id,sha256);
create index facts_evidence_attachment_idx on public.facts_evidence(owner_id,attachment_id);
create index facts_relationships_request_idx on public.facts_relationships(owner_id,request_id);
create index facts_audit_owner_changed_idx on public.facts_audit_entries(owner_id,changed_at desc);

create function public.facts_validate_relationship_row()
returns trigger
language plpgsql
security invoker
set search_path=''
as $$
declare
 v_fact_kind text;
 v_request_kind text;
begin
 select kind into v_fact_kind from public.facts where owner_id=new.owner_id and id=new.fact_id;
 select kind into v_request_kind from public.facts where owner_id=new.owner_id and id=new.request_id;
 if v_fact_kind is null or v_fact_kind not in ('expense','payment','transfer') then
  raise exception 'FACTS_RELATIONSHIP_DISBURSEMENT_REQUIRED' using errcode='23514';
 end if;
 if v_request_kind is null or v_request_kind<>'request' then
  raise exception 'FACTS_RELATIONSHIP_REQUEST_REQUIRED' using errcode='23514';
 end if;
 return new;
end;
$$;
revoke all on function public.facts_validate_relationship_row() from public,anon;
grant execute on function public.facts_validate_relationship_row() to authenticated;
create trigger facts_relationships_validate
before insert or update of owner_id,kind,fact_id,request_id on public.facts_relationships
for each row execute function public.facts_validate_relationship_row();

alter table public.facts_dependents enable row level security;
alter table public.facts enable row level security;
alter table public.facts_attachments enable row level security;
alter table public.facts_evidence enable row level security;
alter table public.facts_evidence_links enable row level security;
alter table public.facts_relationships enable row level security;
alter table public.facts_mutations enable row level security;
alter table public.facts_audit_entries enable row level security;

revoke all on public.facts_dependents,public.facts,public.facts_attachments,public.facts_evidence,public.facts_evidence_links,public.facts_relationships,public.facts_mutations,public.facts_audit_entries from public,anon;

grant select,insert,update,delete on public.facts_dependents,public.facts,public.facts_attachments,public.facts_evidence,public.facts_evidence_links,public.facts_relationships to authenticated;
grant select,insert on public.facts_mutations,public.facts_audit_entries to authenticated;

create policy facts_dependents_owner_all on public.facts_dependents for all to authenticated
 using ((select auth.uid())=owner_id) with check ((select auth.uid())=owner_id);
create policy facts_owner_all on public.facts for all to authenticated
 using ((select auth.uid())=owner_id) with check ((select auth.uid())=owner_id);
create policy facts_attachments_owner_all on public.facts_attachments for all to authenticated
 using ((select auth.uid())=owner_id) with check ((select auth.uid())=owner_id);
create policy facts_evidence_owner_all on public.facts_evidence for all to authenticated
 using ((select auth.uid())=owner_id) with check ((select auth.uid())=owner_id);
create policy facts_evidence_links_owner_all on public.facts_evidence_links for all to authenticated
 using ((select auth.uid())=owner_id) with check ((select auth.uid())=owner_id);
create policy facts_relationships_owner_all on public.facts_relationships for all to authenticated
 using ((select auth.uid())=owner_id) with check ((select auth.uid())=owner_id);
create policy facts_mutations_owner_read on public.facts_mutations for select to authenticated
 using ((select auth.uid())=owner_id);
create policy facts_mutations_owner_insert on public.facts_mutations for insert to authenticated
 with check ((select auth.uid())=owner_id);
create policy facts_audit_owner_read on public.facts_audit_entries for select to authenticated
 using ((select auth.uid())=owner_id);
create policy facts_audit_owner_insert on public.facts_audit_entries for insert to authenticated
 with check ((select auth.uid())=owner_id);
