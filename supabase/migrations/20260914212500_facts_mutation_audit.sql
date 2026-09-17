alter table public.facts_mutations
 add column operation text not null check (char_length(btrim(operation)) between 1 and 80),
 add column entity_type text not null check (entity_type in ('dependent','fact','evidence','attachment','relationship')),
 add column entity_id uuid not null,
 add column request_payload jsonb not null check (jsonb_typeof(request_payload)='object'),
 add column result_payload jsonb,
 add column completed_at timestamptz,
 add constraint facts_mutations_completed_check check (completed_at is null or completed_at>=created_at);

alter table public.facts_evidence_links drop constraint facts_evidence_links_evidence_fk;
alter table public.facts_evidence_links drop constraint facts_evidence_links_fact_fk;
alter table public.facts_evidence_links
 add constraint facts_evidence_links_evidence_fk foreign key(owner_id,evidence_id) references public.facts_evidence(owner_id,id) on delete restrict,
 add constraint facts_evidence_links_fact_fk foreign key(owner_id,fact_id) references public.facts(owner_id,id) on delete restrict;

revoke insert,update,delete on public.facts_dependents,public.facts,public.facts_attachments,public.facts_evidence,public.facts_evidence_links,public.facts_relationships,public.facts_mutations,public.facts_audit_entries from authenticated;
revoke all on function public.facts_validate_relationship_row() from public,anon,authenticated;

create function public._facts_begin_mutation(
 p_mutation_id uuid,
 p_operation text,
 p_entity_type text,
 p_entity_id uuid,
 p_source text,
 p_created_by text,
 p_request_payload jsonb
)
returns table(replayed boolean,stored_result jsonb)
language plpgsql
security definer
set search_path=''
as $$
declare
 v_owner uuid:=auth.uid();
 v_existing public.facts_mutations%rowtype;
begin
 if v_owner is null then
  raise exception 'FACTS_AUTH_REQUIRED' using errcode='42501';
 end if;
 if p_mutation_id is null or p_entity_id is null or p_request_payload is null then
  raise exception 'FACTS_MUTATION_INVALID' using errcode='22023';
 end if;

 insert into public.facts_mutations(owner_id,mutation_id,source,created_by,created_at,operation,entity_type,entity_id,request_payload)
 values(v_owner,p_mutation_id,p_source,p_created_by,now(),p_operation,p_entity_type,p_entity_id,p_request_payload)
 on conflict(owner_id,mutation_id) do nothing;

 if found then
  return query select false,null::jsonb;
  return;
 end if;

 select * into v_existing
 from public.facts_mutations
 where owner_id=v_owner and mutation_id=p_mutation_id;

 if not found then
  raise exception 'FACTS_MUTATION_NOT_FOUND' using errcode='40001';
 end if;
 if v_existing.operation<>p_operation
  or v_existing.entity_type<>p_entity_type
  or v_existing.entity_id<>p_entity_id
  or v_existing.source<>p_source
  or v_existing.created_by<>p_created_by
  or v_existing.request_payload<>p_request_payload then
  raise exception 'FACTS_MUTATION_ID_REUSED' using errcode='22023';
 end if;
 if v_existing.completed_at is null then
  raise exception 'FACTS_MUTATION_INCOMPLETE' using errcode='40001';
 end if;

 return query select true,v_existing.result_payload;
end;
$$;

create function public._facts_finish_mutation(p_mutation_id uuid,p_result_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
 v_owner uuid:=auth.uid();
begin
 if v_owner is null then
  raise exception 'FACTS_AUTH_REQUIRED' using errcode='42501';
 end if;
 update public.facts_mutations
 set result_payload=p_result_payload,completed_at=now()
 where owner_id=v_owner and mutation_id=p_mutation_id and completed_at is null;
 if not found then
  raise exception 'FACTS_MUTATION_FINISH_INVALID' using errcode='40001';
 end if;
 return p_result_payload;
end;
$$;

create function public._facts_write_audit(
 p_mutation_id uuid,
 p_entity_type text,
 p_entity_id uuid,
 p_action text,
 p_source text,
 p_created_by text,
 p_before jsonb,
 p_after jsonb
)
returns void
language plpgsql
security definer
set search_path=''
as $$
declare
 v_owner uuid:=auth.uid();
begin
 if v_owner is null then
  raise exception 'FACTS_AUTH_REQUIRED' using errcode='42501';
 end if;
 insert into public.facts_audit_entries(id,owner_id,mutation_id,entity_type,entity_id,action,source,created_by,changed_at,before_state,after_state)
 values(gen_random_uuid(),v_owner,p_mutation_id,p_entity_type,p_entity_id,p_action,p_source,p_created_by,now(),p_before,p_after);
end;
$$;

revoke all on function public._facts_begin_mutation(uuid,text,text,uuid,text,text,jsonb) from public,anon,authenticated;
revoke all on function public._facts_finish_mutation(uuid,jsonb) from public,anon,authenticated;
revoke all on function public._facts_write_audit(uuid,text,uuid,text,text,text,jsonb,jsonb) from public,anon,authenticated;

create function public.facts_upsert_dependent(
 p_mutation_id uuid,
 p_id uuid,
 p_name text,
 p_birth_date date,
 p_source text,
 p_created_by text
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
 v_owner uuid:=auth.uid();
 v_replayed boolean;
 v_stored jsonb;
 v_before public.facts_dependents%rowtype;
 v_after public.facts_dependents%rowtype;
 v_exists boolean;
 v_request jsonb:=jsonb_build_object('name',p_name,'birthDate',p_birth_date);
 v_result jsonb;
 v_action text;
begin
 if v_owner is null then raise exception 'FACTS_AUTH_REQUIRED' using errcode='42501'; end if;
 select b.replayed,b.stored_result into v_replayed,v_stored
 from public._facts_begin_mutation(p_mutation_id,'upsert_dependent','dependent',p_id,p_source,p_created_by,v_request) b;
 if v_replayed then return v_stored; end if;

 select * into v_before from public.facts_dependents where owner_id=v_owner and id=p_id;
 v_exists:=found;
 if v_exists then
  update public.facts_dependents set name=p_name,birth_date=p_birth_date,updated_at=now()
  where owner_id=v_owner and id=p_id returning * into v_after;
  v_action:='update';
 else
  insert into public.facts_dependents(id,owner_id,name,birth_date,created_at,updated_at)
  values(p_id,v_owner,p_name,p_birth_date,now(),now()) returning * into v_after;
  v_action:='create';
 end if;

 v_result:=to_jsonb(v_after)-'owner_id';
 perform public._facts_write_audit(p_mutation_id,'dependent',p_id,v_action,p_source,p_created_by,case when v_exists then to_jsonb(v_before)-'owner_id' else null end,v_result);
 return public._facts_finish_mutation(p_mutation_id,v_result);
end;
$$;

create function public.facts_create_fact(
 p_mutation_id uuid,
 p_id uuid,
 p_dependent_id uuid,
 p_kind text,
 p_title text,
 p_category text,
 p_notes text,
 p_occurred_at date,
 p_amount_cents bigint,
 p_transfer_purpose text,
 p_request_total_cents bigint,
 p_source text,
 p_source_detail text,
 p_created_by text,
 p_provenance_kind text
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
 v_owner uuid:=auth.uid();
 v_replayed boolean;
 v_stored jsonb;
 v_fact public.facts%rowtype;
 v_request jsonb:=jsonb_build_object(
  'dependentId',p_dependent_id,'kind',p_kind,'title',p_title,'category',p_category,'notes',p_notes,
  'occurredAt',p_occurred_at,'amountCents',p_amount_cents,'transferPurpose',p_transfer_purpose,
  'requestTotalCents',p_request_total_cents,'sourceDetail',p_source_detail,'provenanceKind',p_provenance_kind
 );
 v_result jsonb;
begin
 if v_owner is null then raise exception 'FACTS_AUTH_REQUIRED' using errcode='42501'; end if;
 select b.replayed,b.stored_result into v_replayed,v_stored
 from public._facts_begin_mutation(p_mutation_id,'create_fact','fact',p_id,p_source,p_created_by,v_request) b;
 if v_replayed then return v_stored; end if;

 insert into public.facts(id,owner_id,dependent_id,kind,title,category,notes,occurred_at,amount_cents,transfer_purpose,request_total_cents,source,source_detail,created_by,provenance_kind,created_at,updated_at)
 values(p_id,v_owner,p_dependent_id,p_kind,p_title,p_category,p_notes,p_occurred_at,p_amount_cents,p_transfer_purpose,p_request_total_cents,p_source,p_source_detail,p_created_by,p_provenance_kind,now(),now())
 returning * into v_fact;

 v_result:=to_jsonb(v_fact)-'owner_id';
 perform public._facts_write_audit(p_mutation_id,'fact',p_id,'create',p_source,p_created_by,null,v_result);
 return public._facts_finish_mutation(p_mutation_id,v_result);
end;
$$;

create function public.facts_update_fact(
 p_mutation_id uuid,
 p_id uuid,
 p_kind text,
 p_title text,
 p_category text,
 p_notes text,
 p_occurred_at date,
 p_amount_cents bigint,
 p_transfer_purpose text,
 p_request_total_cents bigint,
 p_source_detail text,
 p_source text,
 p_created_by text
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
 v_owner uuid:=auth.uid();
 v_replayed boolean;
 v_stored jsonb;
 v_before public.facts%rowtype;
 v_after public.facts%rowtype;
 v_request jsonb:=jsonb_build_object(
  'kind',p_kind,'title',p_title,'category',p_category,'notes',p_notes,'occurredAt',p_occurred_at,
  'amountCents',p_amount_cents,'transferPurpose',p_transfer_purpose,'requestTotalCents',p_request_total_cents,'sourceDetail',p_source_detail
 );
 v_result jsonb;
begin
 if v_owner is null then raise exception 'FACTS_AUTH_REQUIRED' using errcode='42501'; end if;
 select b.replayed,b.stored_result into v_replayed,v_stored
 from public._facts_begin_mutation(p_mutation_id,'update_fact','fact',p_id,p_source,p_created_by,v_request) b;
 if v_replayed then return v_stored; end if;

 select * into v_before from public.facts where owner_id=v_owner and id=p_id;
 if not found then raise exception 'FACTS_FACT_NOT_FOUND' using errcode='P0002'; end if;

 update public.facts
 set kind=p_kind,title=p_title,category=p_category,notes=p_notes,occurred_at=p_occurred_at,
  amount_cents=p_amount_cents,transfer_purpose=p_transfer_purpose,request_total_cents=p_request_total_cents,
  source_detail=p_source_detail,updated_at=now()
 where owner_id=v_owner and id=p_id
 returning * into v_after;

 v_result:=to_jsonb(v_after)-'owner_id';
 perform public._facts_write_audit(p_mutation_id,'fact',p_id,'update',p_source,p_created_by,to_jsonb(v_before)-'owner_id',v_result);
 return public._facts_finish_mutation(p_mutation_id,v_result);
end;
$$;

create function public.facts_delete_fact(
 p_mutation_id uuid,
 p_id uuid,
 p_source text,
 p_created_by text
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
 v_owner uuid:=auth.uid();
 v_replayed boolean;
 v_stored jsonb;
 v_before public.facts%rowtype;
 v_request jsonb:='{}'::jsonb;
 v_result jsonb:=jsonb_build_object('id',p_id,'deleted',true);
begin
 if v_owner is null then raise exception 'FACTS_AUTH_REQUIRED' using errcode='42501'; end if;
 select b.replayed,b.stored_result into v_replayed,v_stored
 from public._facts_begin_mutation(p_mutation_id,'delete_fact','fact',p_id,p_source,p_created_by,v_request) b;
 if v_replayed then return v_stored; end if;

 select * into v_before from public.facts where owner_id=v_owner and id=p_id;
 if not found then raise exception 'FACTS_FACT_NOT_FOUND' using errcode='P0002'; end if;
 perform public._facts_write_audit(p_mutation_id,'fact',p_id,'delete',p_source,p_created_by,to_jsonb(v_before)-'owner_id',null);
 delete from public.facts where owner_id=v_owner and id=p_id;
 return public._facts_finish_mutation(p_mutation_id,v_result);
end;
$$;

create function public.facts_link_request(
 p_mutation_id uuid,
 p_id uuid,
 p_fact_id uuid,
 p_request_id uuid,
 p_source text,
 p_created_by text
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
 v_owner uuid:=auth.uid();
 v_replayed boolean;
 v_stored jsonb;
 v_relationship public.facts_relationships%rowtype;
 v_request jsonb:=jsonb_build_object('factId',p_fact_id,'requestId',p_request_id);
 v_result jsonb;
begin
 if v_owner is null then raise exception 'FACTS_AUTH_REQUIRED' using errcode='42501'; end if;
 select b.replayed,b.stored_result into v_replayed,v_stored
 from public._facts_begin_mutation(p_mutation_id,'link_request','relationship',p_id,p_source,p_created_by,v_request) b;
 if v_replayed then return v_stored; end if;

 insert into public.facts_relationships(id,owner_id,kind,fact_id,request_id,created_at)
 values(p_id,v_owner,'fulfills_request',p_fact_id,p_request_id,now()) returning * into v_relationship;
 v_result:=to_jsonb(v_relationship)-'owner_id';
 perform public._facts_write_audit(p_mutation_id,'relationship',p_id,'link',p_source,p_created_by,null,v_result);
 return public._facts_finish_mutation(p_mutation_id,v_result);
end;
$$;

create function public.facts_unlink_request(
 p_mutation_id uuid,
 p_id uuid,
 p_source text,
 p_created_by text
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
 v_owner uuid:=auth.uid();
 v_replayed boolean;
 v_stored jsonb;
 v_before public.facts_relationships%rowtype;
 v_request jsonb:='{}'::jsonb;
 v_result jsonb:=jsonb_build_object('id',p_id,'unlinked',true);
begin
 if v_owner is null then raise exception 'FACTS_AUTH_REQUIRED' using errcode='42501'; end if;
 select b.replayed,b.stored_result into v_replayed,v_stored
 from public._facts_begin_mutation(p_mutation_id,'unlink_request','relationship',p_id,p_source,p_created_by,v_request) b;
 if v_replayed then return v_stored; end if;

 select * into v_before from public.facts_relationships where owner_id=v_owner and id=p_id;
 if not found then raise exception 'FACTS_RELATIONSHIP_NOT_FOUND' using errcode='P0002'; end if;
 perform public._facts_write_audit(p_mutation_id,'relationship',p_id,'unlink',p_source,p_created_by,to_jsonb(v_before)-'owner_id',null);
 delete from public.facts_relationships where owner_id=v_owner and id=p_id;
 return public._facts_finish_mutation(p_mutation_id,v_result);
end;
$$;

revoke all on function public.facts_upsert_dependent(uuid,uuid,text,date,text,text) from public,anon;
revoke all on function public.facts_create_fact(uuid,uuid,uuid,text,text,text,text,date,bigint,text,bigint,text,text,text,text) from public,anon;
revoke all on function public.facts_update_fact(uuid,uuid,text,text,text,text,date,bigint,text,bigint,text,text,text) from public,anon;
revoke all on function public.facts_delete_fact(uuid,uuid,text,text) from public,anon;
revoke all on function public.facts_link_request(uuid,uuid,uuid,uuid,text,text) from public,anon;
revoke all on function public.facts_unlink_request(uuid,uuid,text,text) from public,anon;

grant execute on function public.facts_upsert_dependent(uuid,uuid,text,date,text,text) to authenticated;
grant execute on function public.facts_create_fact(uuid,uuid,uuid,text,text,text,text,date,bigint,text,bigint,text,text,text,text) to authenticated;
grant execute on function public.facts_update_fact(uuid,uuid,text,text,text,text,date,bigint,text,bigint,text,text,text) to authenticated;
grant execute on function public.facts_delete_fact(uuid,uuid,text,text) to authenticated;
grant execute on function public.facts_link_request(uuid,uuid,uuid,uuid,text,text) to authenticated;
grant execute on function public.facts_unlink_request(uuid,uuid,text,text) to authenticated;
