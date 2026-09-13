-- Gate 13: hard production cap of two active followers and transactional FIFO queue promotion.
-- The master row lock serializes join/leave operations for one master.

create or replace function public.join_master(p_user_id uuid, p_master_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_master public.masters%rowtype;
  v_existing public.follows%rowtype;
  v_follow public.follows%rowtype;
  v_active_count integer;
  v_capacity integer;
  v_queue_position integer;
begin
  if p_user_id is null then raise exception 'user required'; end if;

  select * into v_master
  from public.masters
  where id = p_master_id and active = true
  for update;
  if not found then raise exception 'master not found'; end if;

  -- Gate 13 production capacity is hard-limited to two active followers.
  v_capacity := least(greatest(v_master.max_followers, 1), 2);

  select * into v_existing
  from public.follows
  where user_id = p_user_id
    and master_id = p_master_id
    and status in ('active','queued')
  limit 1;

  if found then
    if v_existing.status = 'queued' then
      select count(*) into v_queue_position
      from public.follows q
      where q.master_id = p_master_id
        and q.status = 'queued'
        and (q.created_at, q.id) <= (v_existing.created_at, v_existing.id);
    end if;
    return jsonb_build_object(
      'status', v_existing.status,
      'queue_position', case when v_existing.status = 'queued' then v_queue_position else null end,
      'duplicate', true,
      'follow_id', v_existing.id
    );
  end if;

  select count(*) into v_active_count
  from public.follows
  where master_id = p_master_id and status = 'active';

  if v_active_count < v_capacity then
    insert into public.follows(user_id, master_id, status)
    values (p_user_id, p_master_id, 'active')
    returning * into v_follow;

    return jsonb_build_object(
      'status','active',
      'queue_position',null,
      'duplicate',false,
      'follow_id',v_follow.id
    );
  end if;

  insert into public.follows(user_id, master_id, status)
  values (p_user_id, p_master_id, 'queued')
  returning * into v_follow;

  select count(*) into v_queue_position
  from public.follows q
  where q.master_id = p_master_id
    and q.status = 'queued'
    and (q.created_at, q.id) <= (v_follow.created_at, v_follow.id);

  return jsonb_build_object(
    'status','queued',
    'queue_position',v_queue_position,
    'duplicate',false,
    'follow_id',v_follow.id
  );
end;
$$;

create or replace function public.leave_master(p_user_id uuid, p_master_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_master public.masters%rowtype;
  v_follow public.follows%rowtype;
  v_next public.follows%rowtype;
  v_queue_position integer;
  v_was_active boolean := false;
begin
  if p_user_id is null then raise exception 'user required'; end if;

  select * into v_master
  from public.masters
  where id = p_master_id
  for update;
  if not found then raise exception 'master not found'; end if;

  select * into v_follow
  from public.follows
  where user_id = p_user_id
    and master_id = p_master_id
    and status in ('active','queued')
  limit 1;

  if not found then
    return jsonb_build_object('removed',false,'promoted',null);
  end if;

  v_was_active := v_follow.status = 'active';
  update public.follows
  set status = 'disabled'
  where id = v_follow.id;

  if not v_was_active then
    return jsonb_build_object('removed',true,'promoted',null,'promoted_follow_id',null);
  end if;

  select * into v_next
  from public.follows
  where master_id = p_master_id
    and status = 'queued'
  order by created_at asc, id asc
  limit 1
  for update skip locked;

  if not found then
    return jsonb_build_object('removed',true,'promoted',null,'promoted_follow_id',null);
  end if;

  update public.follows
  set status = 'active'
  where id = v_next.id;

  return jsonb_build_object(
    'removed',true,
    'promoted',v_next.user_id,
    'promoted_follow_id',v_next.id
  );
end;
$$;

revoke all on function public.join_master(uuid,uuid) from public, anon, authenticated;
revoke all on function public.leave_master(uuid,uuid) from public, anon, authenticated;
grant execute on function public.join_master(uuid,uuid) to service_role;
grant execute on function public.leave_master(uuid,uuid) to service_role;
