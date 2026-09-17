create function public.facts_delete_dependent(
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
 v_before public.facts_dependents%rowtype;
 v_request jsonb:='{}'::jsonb;
 v_result jsonb:=jsonb_build_object('id',p_id,'deleted',true);
begin
 if v_owner is null then raise exception 'FACTS_AUTH_REQUIRED' using errcode='42501'; end if;
 select b.replayed,b.stored_result into v_replayed,v_stored
 from public._facts_begin_mutation(p_mutation_id,'delete_dependent','dependent',p_id,p_source,p_created_by,v_request) b;
 if v_replayed then return v_stored; end if;

 select * into v_before from public.facts_dependents where owner_id=v_owner and id=p_id;
 if not found then raise exception 'FACTS_DEPENDENT_NOT_FOUND' using errcode='P0002'; end if;

 perform public._facts_write_audit(p_mutation_id,'dependent',p_id,'delete',p_source,p_created_by,to_jsonb(v_before)-'owner_id',null);
 delete from public.facts_dependents where owner_id=v_owner and id=p_id;
 return public._facts_finish_mutation(p_mutation_id,v_result);
end;
$$;

revoke all on function public.facts_delete_dependent(uuid,uuid,text,text) from public,anon;
grant execute on function public.facts_delete_dependent(uuid,uuid,text,text) to authenticated;
