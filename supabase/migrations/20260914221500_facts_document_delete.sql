create function public.facts_delete_document(
 p_mutation_id uuid,
 p_evidence_id uuid,
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
 v_attachment public.facts_attachments%rowtype;
 v_fact_ids uuid[];
 v_evidence_json jsonb;
 v_attachment_json jsonb;
 v_request jsonb:='{}'::jsonb;
 v_result jsonb;
begin
 if v_owner is null then raise exception 'FACTS_AUTH_REQUIRED' using errcode='42501'; end if;
 select b.replayed,b.stored_result into v_replayed,v_stored
 from public._facts_begin_mutation(p_mutation_id,'delete_document','evidence',p_evidence_id,p_source,p_created_by,v_request) b;
 if v_replayed then return v_stored; end if;

 select * into v_evidence from public.facts_evidence where owner_id=v_owner and id=p_evidence_id;
 if not found then raise exception 'FACTS_EVIDENCE_NOT_FOUND' using errcode='P0002'; end if;
 select * into v_attachment from public.facts_attachments where owner_id=v_owner and id=v_evidence.attachment_id;
 if not found then raise exception 'FACTS_ATTACHMENT_NOT_FOUND' using errcode='P0002'; end if;
 select coalesce(array_agg(fact_id order by fact_id),'{}'::uuid[]) into v_fact_ids
 from public.facts_evidence_links where owner_id=v_owner and evidence_id=p_evidence_id;

 v_evidence_json:=(to_jsonb(v_evidence)-'owner_id')||jsonb_build_object('fact_ids',to_jsonb(v_fact_ids));
 v_attachment_json:=to_jsonb(v_attachment)-'owner_id';
 v_result:=jsonb_build_object('evidence_id',p_evidence_id,'attachment',v_attachment_json,'deleted',true);

 delete from public.facts_evidence_links where owner_id=v_owner and evidence_id=p_evidence_id;
 perform public._facts_write_audit(p_mutation_id,'evidence',p_evidence_id,'delete',p_source,p_created_by,v_evidence_json,null);
 delete from public.facts_evidence where owner_id=v_owner and id=p_evidence_id;
 perform public._facts_write_audit(p_mutation_id,'attachment',v_attachment.id,'delete',p_source,p_created_by,v_attachment_json,null);
 delete from public.facts_attachments where owner_id=v_owner and id=v_attachment.id;

 return public._facts_finish_mutation(p_mutation_id,v_result);
end;
$$;

revoke all on function public.facts_delete_document(uuid,uuid,text,text) from public,anon;
revoke execute on function public.facts_delete_evidence(uuid,uuid,text,text) from authenticated;
revoke execute on function public.facts_delete_attachment(uuid,uuid,text,text) from authenticated;
grant execute on function public.facts_delete_document(uuid,uuid,text,text) to authenticated;
