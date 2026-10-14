-- Apply after nurse_surgeon_roles. Nurses coordinate patient flow and spaces.
begin;
create or replace function public.set_resource_state(p_id uuid, p_state text) returns void
language plpgsql security definer set search_path = '' as $$
declare space_name text; staff_role text := public.current_staff_role();
begin
  if staff_role is null or staff_role not in ('coordinator','nurse') then raise exception 'A nurse or coordinator account is required.' using errcode = '42501'; end if;
  select name into space_name from public.resources where id = p_id for update;
  if not found then raise exception 'Space not found.'; end if;
  if exists (select 1 from public.visits where resource_id = p_id and status not in ('discharged', 'transferred')) then raise exception 'Release the assigned patient before changing this space.'; end if;
  update public.resources set state = p_state where id = p_id;
  insert into public.audit_events(actor, actor_id, action, summary)
  select trim(first_name || ' ' || last_name), auth.uid(), 'resource_updated', space_name || ' · ' || p_state from public.staff_profiles where id = auth.uid();
end $$;


revoke all on function public.set_resource_state(uuid,text) from public,anon;
grant execute on function public.set_resource_state(uuid,text) to authenticated;
notify pgrst, 'reload schema';
commit;
