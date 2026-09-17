create function public.facts_ingest_document(
 p_mutation_id uuid,
 p_attachment_id uuid,
 p_evidence_id uuid,
 p_name text,
 p_mime text,
 p_size bigint,
 p_sha256 text,
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
 v_attachment public.facts_attachments%rowtype;
 v_evidence public.facts_evidence%rowtype;
 v_fact_ids uuid[]:=coalesce(p_fact_ids,'{}'::uuid[]);
 v_path text;
 v_request jsonb:=jsonb_build_object(
  'attachmentId',p_attachment_id,'evidenceId',p_evidence_id,'name',p_name,'mime',p_mime,'size',p_size,'sha256',p_sha256,
  'evidenceSource',p_evidence_source,'extractedText',p_extracted_text,'interpretation',p_interpretation,'factIds',to_jsonb(v_fact_ids)
 );
 v_attachment_json jsonb;
 v_evidence_json jsonb;
 v_result jsonb;
begin
 if v_owner is null then raise exception 'FACTS_AUTH_REQUIRED' using errcode='42501'; end if;
 if cardinality(v_fact_ids)>100 then raise exception 'FACTS_EVIDENCE_TOO_MANY_FACTS' using errcode='22023'; end if;
 if (select count(*) from unnest(v_fact_ids) x)<>(select count(distinct x) from unnest(v_fact_ids) x) then
  raise exception 'FACTS_EVIDENCE_DUPLICATE_FACT' using errcode='22023';
 end if;
 select b.replayed,b.stored_result into v_replayed,v_stored
 from public._facts_begin_mutation(p_mutation_id,'ingest_document','evidence',p_evidence_id,p_source,p_created_by,v_request) b;
 if v_replayed then return v_stored; end if;

 v_path:=v_owner::text||'/'||p_attachment_id::text||'/'||p_sha256;
 if not exists(select 1 from storage.objects where bucket_id='facts-attachments' and name=v_path) then
  raise exception 'FACTS_ATTACHMENT_OBJECT_NOT_FOUND' using errcode='P0002';
 end if;

 insert into public.facts_attachments(id,owner_id,name,mime,size,sha256,created_at)
 values(p_attachment_id,v_owner,p_name,p_mime,p_size,p_sha256,now())
 returning * into v_attachment;

 insert into public.facts_evidence(id,owner_id,attachment_id,source,extracted_text,interpretation,created_at)
 values(p_evidence_id,v_owner,p_attachment_id,p_evidence_source,p_extracted_text,p_interpretation,now())
 returning * into v_evidence;

 insert into public.facts_evidence_links(owner_id,evidence_id,fact_id)
 select v_owner,p_evidence_id,x from unnest(v_fact_ids) x;

 v_attachment_json:=to_jsonb(v_attachment)-'owner_id';
 v_evidence_json:=(to_jsonb(v_evidence)-'owner_id')||jsonb_build_object('fact_ids',to_jsonb(v_fact_ids));
 v_result:=jsonb_build_object('attachment',v_attachment_json,'evidence',v_evidence_json);
 perform public._facts_write_audit(p_mutation_id,'attachment',p_attachment_id,'create',p_source,p_created_by,null,v_attachment_json);
 perform public._facts_write_audit(p_mutation_id,'evidence',p_evidence_id,'create',p_source,p_created_by,null,v_evidence_json);
 return public._facts_finish_mutation(p_mutation_id,v_result);
end;
$$;

revoke all on function public.facts_ingest_document(uuid,uuid,uuid,text,text,bigint,text,text,text,jsonb,uuid[],text,text) from public,anon;
revoke execute on function public.facts_register_attachment(uuid,uuid,text,text,bigint,text,text,text) from authenticated;
revoke execute on function public.facts_create_evidence(uuid,uuid,uuid,text,text,jsonb,uuid[],text,text) from authenticated;
grant execute on function public.facts_ingest_document(uuid,uuid,uuid,text,text,bigint,text,text,text,jsonb,uuid[],text,text) to authenticated;
