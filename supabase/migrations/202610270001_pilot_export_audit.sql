-- Pilot (single-department) schema only: records coordinator CSV exports in the activity log.
-- Who and when come from the session; which rows are listed in the summary (first 25 references)
-- and in full in after_record, which staff cannot select directly.
begin;

create function public.record_export(p_scope text, p_filters jsonb, p_patient_refs text[]) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  actor_name text;
  event_id uuid;
  refs text[] := coalesce(p_patient_refs, '{}');
  row_count integer := cardinality(coalesce(p_patient_refs, '{}'));
  listed text;
begin
  if public.current_staff_role() is distinct from 'coordinator' then
    raise exception 'Only coordinators can export visits.' using errcode = '42501';
  end if;
  if p_scope is null or p_scope not in ('board', 'completed') then
    raise exception 'Unknown export scope.' using errcode = '22023';
  end if;
  if row_count > 10000 then
    raise exception 'Export is limited to 10,000 visits.' using errcode = '22023';
  end if;
  select trim(first_name || ' ' || last_name) into actor_name from public.staff_profiles where id = auth.uid();
  listed := case
    when row_count = 0 then ''
    when row_count <= 25 then ': ' || array_to_string(refs, ', ')
    else ': ' || array_to_string(refs[1:25], ', ') || ' and ' || (row_count - 25) || ' more'
  end;
  insert into public.audit_events(actor, actor_id, action, summary, after_record)
  values (
    coalesce(actor_name, 'Coordinator'), auth.uid(), 'exported',
    'Exported ' || row_count || case when p_scope = 'board' then ' current board' else ' completed' end
      || case when row_count = 1 then ' visit' else ' visits' end || ' to CSV' || listed,
    jsonb_build_object('scope', p_scope, 'filters', coalesce(p_filters, '{}'::jsonb),
                       'row_count', row_count, 'patient_refs', to_jsonb(refs))
  )
  returning id into event_id;
  return event_id;
end $$;

revoke all on function public.record_export(text, jsonb, text[]) from public, anon;
grant execute on function public.record_export(text, jsonb, text[]) to authenticated;
notify pgrst, 'reload schema';
commit;
