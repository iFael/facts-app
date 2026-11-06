
create table if not exists public.facts_bank_decision_audit (
 id uuid primary key default gen_random_uuid(),
 owner_id uuid not null references auth.users(id) on delete cascade,
 review_id uuid not null references public.facts_bank_reviews(id) on delete restrict,
 transaction_id uuid not null references public.facts_bank_transactions(id) on delete restrict,
 actor_id uuid not null,
 action text not null,
 competence_month date,
 category text,
 learned_rule_id uuid,
 decided_at timestamptz not null default now()
);
alter table public.facts_bank_decision_audit enable row level security;
revoke all on public.facts_bank_decision_audit from public,anon,authenticated;
grant select on public.facts_bank_decision_audit to authenticated;
drop policy if exists facts_bank_decision_audit_owner_select on public.facts_bank_decision_audit;
create policy facts_bank_decision_audit_owner_select on public.facts_bank_decision_audit
for select to authenticated using(owner_id=(select auth.uid()));

create or replace function public.facts_resolve_bank_review(
 p_review_id uuid,
 p_action text,
 p_category text default 'outros',
 p_competence text default null,
 p_remember boolean default false
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
 v_owner uuid:=auth.uid();
 v_review public.facts_bank_reviews%rowtype;
 v_tx public.facts_bank_transactions%rowtype;
 v_fact_id uuid;
 v_found uuid;
 v_mutation uuid;
 v_result jsonb;
 v_month date;
 v_kind text;
 v_title text;
 v_notes text;
 v_rule_id uuid;
 v_match text;
begin
 if v_owner is null then raise exception 'FACTS_AUTH_REQUIRED' using errcode='42501'; end if;
 if p_action not in ('pensao','adicional','reembolso','noah_expense','ignore')
 then raise exception 'FACTS_BANK_ACTION_INVALID' using errcode='22023'; end if;
 if p_category not in ('alimentacao','saude','vestuario','transporte','higiene','educacao','lazer','outros')
 then raise exception 'FACTS_BANK_CATEGORY_INVALID' using errcode='22023'; end if;
 select * into v_review from public.facts_bank_reviews
 where id=p_review_id and owner_id=v_owner for update;
 if not found then raise exception 'FACTS_BANK_REVIEW_NOT_FOUND' using errcode='P0002'; end if;
 if v_review.status<>'pending' then
  if v_review.resolved_action=p_action then
   return jsonb_build_object('status','already_resolved','reviewId',v_review.id);
  end if;
  raise exception 'FACTS_BANK_REVIEW_CLOSED' using errcode='22023';
 end if;
 select * into v_tx from public.facts_bank_transactions
 where owner_id=v_owner and id=v_review.transaction_id for update;
 if not found then raise exception 'FACTS_BANK_TRANSACTION_NOT_FOUND' using errcode='P0002'; end if;
 if v_tx.fact_id is not null then raise exception 'FACTS_BANK_ALREADY_LINKED' using errcode='22023'; end if;
 if p_action in ('pensao','adicional','noah_expense') and v_tx.direction<>'outgoing'
 then raise exception 'FACTS_BANK_DIRECTION_INVALID' using errcode='22023'; end if;

 if p_competence is not null then
  if p_competence !~ '^\d{4}-\d{2}$' or substring(p_competence,6,2)::integer not between 1 and 12
  then raise exception 'FACTS_BANK_COMPETENCE_INVALID' using errcode='22023'; end if;
  v_month:=(p_competence||'-01')::date;
 elsif p_action='pensao' then
  v_month:=date_trunc('month',v_tx.occurred_at)::date;
 end if;

 if p_action='pensao' then
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_owner::text||v_month::text,0));
  if exists(
   select 1 from public.facts_bank_transactions b
   where b.owner_id=v_owner and b.id<>v_tx.id and b.classification='pensao' and b.competence_month=v_month
     and b.fact_id is not null
  ) then raise exception 'FACTS_BANK_PENSION_COMPETENCE_EXISTS' using errcode='23505'; end if;
  select f.id into v_found from public.facts f where f.owner_id=v_owner
   and f.dependent_id=v_review.dependent_id and f.kind='transfer'
   and f.transfer_purpose='pensao' and f.occurred_at>=v_month
   and f.occurred_at<(v_month+interval '1 month')::date
   order by f.created_at limit 1;
  if v_found is not null then
   if exists(select 1 from public.facts f where f.id=v_found and f.occurred_at=v_tx.occurred_at and f.amount_cents=v_tx.amount_cents)
   then v_fact_id:=v_found;
   else raise exception 'FACTS_BANK_PENSION_COMPETENCE_EXISTS' using errcode='23505'; end if;
  end if;
 end if;

 if p_action in ('pensao','adicional','noah_expense') and v_fact_id is null then
  v_fact_id:=gen_random_uuid();
  v_mutation:=gen_random_uuid();
  v_kind:=case when p_action='noah_expense' then 'expense' else 'transfer' end;
  v_title:=case
   when p_action='pensao' then 'Pensão alimentícia — '||to_char(v_month,'MM/YYYY')
   when p_action='noah_expense' then 'Gasto do Noah — '||left(coalesce(nullif(v_tx.merchant_name,''),nullif(v_tx.description,''),'Compra'),120)
   else 'Transferência para Agata — '||to_char(v_tx.occurred_at,'DD/MM/YYYY') end;
  v_notes:='Classificado pelo usuário na conciliação bancária. Pluggy: '||v_tx.provider_transaction_id||'.';
  insert into public.facts_mutations(
   owner_id,mutation_id,source,created_by,created_at,operation,entity_type,entity_id,
   request_payload,result_payload,completed_at
  ) values (
   v_owner,v_mutation,'ui','user',now(),'confirm_bank_transaction','fact',v_fact_id,
   jsonb_build_object('transactionId',v_tx.id,'reviewId',v_review.id,'action',p_action,
    'competence',v_month,'category',p_category),null,null
  );
  insert into public.facts(
   id,owner_id,dependent_id,kind,title,category,notes,occurred_at,amount_cents,
   transfer_purpose,request_total_cents,source,source_detail,created_by,provenance_kind,created_at,updated_at
  ) values (
   v_fact_id,v_owner,v_review.dependent_id,v_kind,left(v_title,160),
   case when v_kind='expense' then p_category else 'outros' end,
   v_notes,v_tx.occurred_at,v_tx.amount_cents,
   case when v_kind='transfer' then p_action else null end,
   null,'ui','Conciliação bancária','user','evidence_derived',now(),now()
  );
  select to_jsonb(f)-'owner_id' into v_result from public.facts f where f.id=v_fact_id;
  insert into public.facts_audit_entries(
   id,owner_id,mutation_id,entity_type,entity_id,action,source,created_by,changed_at,before_state,after_state
  ) values(gen_random_uuid(),v_owner,v_mutation,'fact',v_fact_id,'create','ui','user',now(),null,v_result);
  update public.facts_mutations set result_payload=v_result,completed_at=now()
  where owner_id=v_owner and mutation_id=v_mutation;
 end if;

 if coalesce(p_remember,false) and p_action in ('noah_expense','ignore')
  and v_tx.direction='outgoing' and nullif(btrim(v_tx.merchant_name),'') is not null then
  v_match:=lower(regexp_replace(
   translate(v_tx.merchant_name,'ÁÀÂÃÄáàâãäÉÈÊËéèêëÍÌÎÏíìîïÓÒÔÕÖóòôõöÚÙÛÜúùûüÇç',
                                  'AAAAAaaaaaEEEEeeeeIIIIiiiiOOOOOoooooUUUUuuuuCc'),
   '[^a-zA-Z0-9]+',' ','g'));
  v_match:=btrim(regexp_replace(v_match,'\s+',' ','g'));
  if v_match<>'' then
   insert into public.facts_bank_learning_rules(
    owner_id,dependent_id,match_kind,match_value,direction,action,category
   ) values(v_owner,v_review.dependent_id,'merchant',v_match,'outgoing',
    case when p_action='ignore' then 'ignore' else 'noah_expense' end,
    case when p_action='noah_expense' then p_category else null end)
   on conflict(owner_id,match_kind,match_value,direction) do update set
    action=excluded.action,category=excluded.category,enabled=true,updated_at=now()
   returning id into v_rule_id;
  end if;
 end if;

 update public.facts_bank_transactions set
  fact_id=v_fact_id,
  classification=case when p_action='ignore' then null else p_action end,
  relevance=case when p_action='ignore' then 'irrelevant' when p_action='noah_expense' then 'noah' else 'agata' end,
  relevance_confidence=100,competence_month=v_month,sync_state='reviewed',updated_at=now()
 where id=v_tx.id and owner_id=v_owner;

 update public.facts_bank_reviews set
  status=case when p_action='ignore' then 'dismissed' else 'resolved' end,
  resolved_action=p_action,competence_month=v_month,resolved_at=now()
 where id=v_review.id and owner_id=v_owner;
 insert into public.facts_bank_decision_audit(
  owner_id,review_id,transaction_id,actor_id,action,competence_month,category,learned_rule_id
 ) values(v_owner,v_review.id,v_tx.id,v_owner,p_action,v_month,p_category,v_rule_id);
 return jsonb_build_object('status','resolved','reviewId',v_review.id,
  'action',p_action,'factId',v_fact_id,'learnedRuleId',v_rule_id);
end $$;
revoke all on function public.facts_resolve_bank_review(uuid,text,text,text,boolean) from public,anon;
grant execute on function public.facts_resolve_bank_review(uuid,text,text,text,boolean) to authenticated;
