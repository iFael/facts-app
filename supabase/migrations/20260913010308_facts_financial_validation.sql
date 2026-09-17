create function public.facts_document_valid(doc jsonb)
returns boolean language plpgsql immutable security invoker set search_path='' as $$
declare r jsonb; amount numeric;
begin
 if jsonb_typeof(doc)<>'object' or doc->'formatVersion'<>'1'::jsonb
  or not(doc ?& array['formatVersion','dependent','records','attachments'])
  or jsonb_typeof(doc->'records')<>'array' or jsonb_typeof(doc->'attachments')<>'array' then return false; end if;
 for r in select value from jsonb_array_elements(doc->'records') loop
  if not(r ?& array['id','kind','title','date','amountCents','category','notes','source','attachmentIds','createdAt','updatedAt']) then return false;end if;
  if r->>'kind'='event' then
   if r->'amountCents'<>'null'::jsonb then return false;end if;
  elsif r->>'kind' in ('expense','transfer','request') then
   if jsonb_typeof(r->'amountCents')<>'number' then return false;end if;
   amount:=(r->>'amountCents')::numeric;
   if amount<>trunc(amount) or amount<1 or amount>99999999999 then return false;end if;
  else return false;end if;
  if r ? 'requestTotalCents' then
   if jsonb_typeof(r->'requestTotalCents')<>'number' or r->>'kind'<>'request' then return false;end if;
   amount:=(r->>'requestTotalCents')::numeric;
   if amount<>trunc(amount) or amount<(r->>'amountCents')::numeric or amount>99999999999 then return false;end if;
  end if;
 end loop;
 return true;
 exception when others then return false;
end;
$$;
alter table public.facts_snapshots add constraint facts_document_valid_check check (public.facts_document_valid(document) is true);
revoke all on function public.facts_document_valid(jsonb) from public,anon;
grant execute on function public.facts_document_valid(jsonb) to authenticated;
create policy facts_files_delete on storage.objects for delete to authenticated
 using(bucket_id='facts-attachments' and (storage.foldername(name))[1]=(select auth.uid())::text);
;
