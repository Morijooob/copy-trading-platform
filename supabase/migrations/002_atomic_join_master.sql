create or replace function public.join_master(p_master_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_master public.masters%rowtype;
  v_existing public.follows%rowtype;
  v_active_count integer;
  v_queue_position integer;
  v_follow public.follows%rowtype;
begin
  if v_user is null then raise exception 'authentication required'; end if;
  select * into v_master from public.masters where id=p_master_id and active=true and mode='demo' for update;
  if not found then raise exception 'master not found'; end if;
  select * into v_existing from public.follows where user_id=v_user and master_id=p_master_id and status in ('active','queued') limit 1;
  if found then return jsonb_build_object('status',v_existing.status,'queue_position',null,'duplicate',true); end if;
  select count(*) into v_active_count from public.follows where master_id=p_master_id and status='active';
  if v_active_count < v_master.max_followers then
    insert into public.follows(user_id,master_id,status) values(v_user,p_master_id,'active') returning * into v_follow;
    return jsonb_build_object('status','active','queue_position',null,'duplicate',false,'follow_id',v_follow.id);
  end if;
  insert into public.follows(user_id,master_id,status) values(v_user,p_master_id,'queued') returning * into v_follow;
  select count(*) into v_queue_position from public.follows where master_id=p_master_id and status='queued' and created_at <= v_follow.created_at;
  return jsonb_build_object('status','queued','queue_position',v_queue_position,'duplicate',false,'follow_id',v_follow.id);
end;
$$;
revoke all on function public.join_master(uuid) from public;
grant execute on function public.join_master(uuid) to authenticated;
