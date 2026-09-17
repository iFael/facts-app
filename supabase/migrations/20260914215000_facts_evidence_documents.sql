alter table public.facts_evidence
 add constraint facts_evidence_one_per_attachment unique(owner_id,attachment_id);

create index facts_evidence_links_fact_idx on public.facts_evidence_links(owner_id,fact_id);

create function public.facts_register_attachment(
 p_mutation_id uuid,
 p_id uuid,
 p_name text,
 p_mime text,
 p_size bigint,
 p_sha256 text,
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
 v_attachment public.facts_attachments%rowtype;
 v_path text;
 v_request jsonb:=jsonb_build_object('name',p_name,'mime',p_mime,'size',p_size,'sha256',p_sha256);
 v_result jsonb;
begin
 if v_owner is null then raise exception 'FACTS_AUTH_REQUIRED' using errcode='42501'; end if;
 select b.replayed,b.stored_result into v_replayed,v_stored
 from public._facts_begin_mutation(p_mutation_id,'register_attachment','attachment',p_id,p_source,p_created_by,v_request) b;
 if v_replayed then return v_stored; end if;

 v_path:=v_owner::text||'/'||p_id::text||'/'||p_sha256;
 if not exists(select 1 from storage.objects where bucket_id='facts-attachments' and name=v_path) then
  raise exception 'FACTS_ATTACHMENT_OBJECT_NOT_FOUND' using errcode='P0002';
 end if;

 insert into public.facts_attachments(id,owner_id,name,mime,size,sha256,created_at)
 values(p_id,v_owner,p_name,p_mime,p_size,p_sha256,now())
 returning * into v_attachment;

 v_result:=to_jsonb(v_attachment)-'owner_id';
 perform public._facts_write_audit(p_mutation_id,'attachment',p_id,'create',p_source,p_created_by,null,v_result);
 return public._facts_finish_mutation(p_mutation_id,v_result);
end;
$$;

create function public.facts_create_evidence(
 p_mutation_id uuid,
 p_id uuid,
 p_attachment_id uuid,
 p_evidence_source text,
 p_extracted_text text,
 p_interpretation jsonb,
 p_fact_ids uuid[],
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
 v_evidence public.facts_evidence%rowtype;
 v_fact_ids uuid[]:=coalesce(p_fact_ids,'{}'::uuid[]);
 v_request jsonb:=jsonb_build_object('attachmentId',p_attachment_id,'evidenceSource',p_evidence_source,'extractedText',p_extracted_text,'interpretation',p_interpretation,'factIds',to_jsonb(v_fact_ids));
 v_result jsonb;
begin
 if v_owner is null then raise exception 'FACTS_AUTH_REQUIRED' using errcode='42501'; end if;
 if cardinality(v_fact_ids)>100 then raise exception 'FACTS_EVIDENCE_TOO_MANY_FACTS' using errcode='22023'; end if;
 if (select count(*) from unnest(v_fact_ids) x)<>(select count(distinct x) from unnest(v_fact_ids) x) then
  raise exception 'FACTS_EVIDENCE_DUPLICATE_FACT' using errcode='22023';
 end if;
 select b.replayed,b.stored_result into v_replayed,v_stored
 from public._facts_begin_mutation(p_mutation_id,'create_evidence','evidence',p_id,p_source,p_created_by,v_request) b;
 if v_replayed then return v_stored; end if;

 insert into public.facts_evidence(id,owner_id,attachment_id,source,extracted_text,interpretation,created_at)
 values(p_id,v_owner,p_attachment_id,p_evidence_source,p_extracted_text,p_interpretation,now())
 returning * into v_evidence;

 insert into public.facts_evidence_links(owner_id,evidence_id,fact_id)
 select v_owner,p_id,x from unnest(v_fact_ids) x;

 v_result:=(to_jsonb(v_evidence)-'owner_id')||jsonb_build_object('fact_ids',to_jsonb(v_fact_ids));
 perform public._facts_write_audit(p_mutation_id,'evidence',p_id,'create',p_source,p_created_by,null,v_result);
 return public._facts_finish_mutation(p_mutation_id,v_result);
end;
$$;

create function public.facts_update_evidence(
 p_mutation_id uuid,
 p_id uuid,
 p_extracted_text text,
 p_interpretation jsonb,
 p_fact_ids uuid[],
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
 v_before public.facts_evidence%rowtype;
 v_after public.facts_evidence%rowtype;
 v_old_fact_ids uuid[];
 v_fact_ids uuid[]:=coalesce(p_fact_ids,'{}'::uuid[]);
 v_request jsonb:=jsonb_build_object('extractedText',p_extracted_text,'interpretation',p_interpretation,'factIds',to_jsonb(v_fact_ids));
 v_before_json jsonb;
 v_result jsonb;
begin
 if v_owner is null then raise exception 'FACTS_AUTH_REQUIRED' using errcode='42501'; end if;
 if cardinality(v_fact_ids)>100 then raise exception 'FACTS_EVIDENCE_TOO_MANY_FACTS' using errcode='22023'; end if;
 if (select count(*) from unnest(v_fact_ids) x)<>(select count(distinct x) from unnest(v_fact_ids) x) then
  raise exception 'FACTS_EVIDENCE_DUPLICATE_FACT' using errcode='22023';
 end if;
 select b.replayed,b.stored_result into v_replayed,v_stored
 from public._facts_begin_mutation(p_mutation_id,'update_evidence','evidence',p_id,p_source,p_created_by,v_request) b;
 if v_replayed then return v_stored; end if;

 select * into v_before from public.facts_evidence where owner_id=v_owner and id=p_id;
 if not found then raise exception 'FACTS_EVIDENCE_NOT_FOUND' using errcode='P0002'; end if;
 select coalesce(array_agg(fact_id order by fact_id),'{}'::uuid[]) into v_old_fact_ids
 from public.facts_evidence_links where owner_id=v_owner and evidence_id=p_id;
 v_before_json:=(to_jsonb(v_before)-'owner_id')||jsonb_build_object('fact_ids',to_jsonb(v_old_fact_ids));

 delete from public.facts_evidence_links where owner_id=v_owner and evidence_id=p_id;
 update public.facts_evidence
 set extracted_text=p_extracted_text,interpretation=p_interpretation
 where owner_id=v_owner and id=p_id returning * into v_after;
 insert into public.facts_evidence_links(owner_id,evidence_id,fact_id)
 select v_owner,p_id,x from unnest(v_fact_ids) x;

 v_result:=(to_jsonb(v_after)-'owner_id')||jsonb_build_object('fact_ids',to_jsonb(v_fact_ids));
 perform public._facts_write_audit(p_mutation_id,'evidence',p_id,'update',p_source,p_created_by,v_before_json,v_result);
 return public._facts_finish_mutation(p_mutation_id,v_result);
end;
$$;

create function public.facts_delete_evidence(
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
 v_before public.facts_evidence%rowtype;
 v_fact_ids uuid[];
 v_before_json jsonb;
 v_request jsonb:='{}'::jsonb;
 v_result jsonb:=jsonb_build_object('id',p_id,'deleted',true);
begin
 if v_owner is null then raise exception 'FACTS_AUTH_REQUIRED' using errcode='42501'; end if;
 select b.replayed,b.stored_result into v_replayed,v_stored
 from public._facts_begin_mutation(p_mutation_id,'delete_evidence','evidence',p_id,p_source,p_created_by,v_request) b;
 if v_replayed then return v_stored; end if;

 select * into v_before from public.facts_evidence where owner_id=v_owner and id=p_id;
 if not found then raise exception 'FACTS_EVIDENCE_NOT_FOUND' using errcode='P0002'; end if;
 select coalesce(array_agg(fact_id order by fact_id),'{}'::uuid[]) into v_fact_ids
 from public.facts_evidence_links where owner_id=v_owner and evidence_id=p_id;
 v_before_json:=(to_jsonb(v_before)-'owner_id')||jsonb_build_object('fact_ids',to_jsonb(v_fact_ids));

 delete from public.facts_evidence_links where owner_id=v_owner and evidence_id=p_id;
 perform public._facts_write_audit(p_mutation_id,'evidence',p_id,'delete',p_source,p_created_by,v_before_json,null);
 delete from public.facts_evidence where owner_id=v_owner and id=p_id;
 return public._facts_finish_mutation(p_mutation_id,v_result);
end;
$$;

create function public.facts_delete_attachment(
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
 v_before public.facts_attachments%rowtype;
 v_before_json jsonb;
 v_request jsonb:='{}'::jsonb;
 v_result jsonb;
begin
 if v_owner is null then raise exception 'FACTS_AUTH_REQUIRED' using errcode='42501'; end if;
 select b.replayed,b.stored_result into v_replayed,v_stored
 from public._facts_begin_mutation(p_mutation_id,'delete_attachment','attachment',p_id,p_source,p_created_by,v_request) b;
 if v_replayed then return v_stored; end if;

 select * into v_before from public.facts_attachments where owner_id=v_owner and id=p_id;
 if not found then raise exception 'FACTS_ATTACHMENT_NOT_FOUND' using errcode='P0002'; end if;
 if exists(select 1 from public.facts_evidence where owner_id=v_owner and attachment_id=p_id) then
  raise exception 'FACTS_ATTACHMENT_IN_USE' using errcode='23503';
 end if;
 v_before_json:=to_jsonb(v_before)-'owner_id';
 v_result:=v_before_json||jsonb_build_object('deleted',true);
 perform public._facts_write_audit(p_mutation_id,'attachment',p_id,'delete',p_source,p_created_by,v_before_json,null);
 delete from public.facts_attachments where owner_id=v_owner and id=p_id;
 return public._facts_finish_mutation(p_mutation_id,v_result);
end;
$$;

revoke all on function public.facts_register_attachment(uuid,uuid,text,text,bigint,text,text,text) from public,anon;
revoke all on function public.facts_create_evidence(uuid,uuid,uuid,text,text,jsonb,uuid[],text,text) from public,anon;
revoke all on function public.facts_update_evidence(uuid,uuid,text,jsonb,uuid[],text,text) from public,anon;
revoke all on function public.facts_delete_evidence(uuid,uuid,text,text) from public,anon;
revoke all on function public.facts_delete_attachment(uuid,uuid,text,text) from public,anon;

grant execute on function public.facts_register_attachment(uuid,uuid,text,text,bigint,text,text,text) to authenticated;
grant execute on function public.facts_create_evidence(uuid,uuid,uuid,text,text,jsonb,uuid[],text,text) to authenticated;
grant execute on function public.facts_update_evidence(uuid,uuid,text,jsonb,uuid[],text,text) to authenticated;
grant execute on function public.facts_delete_evidence(uuid,uuid,text,text) to authenticated;
grant execute on function public.facts_delete_attachment(uuid,uuid,text,text) to authenticated;
