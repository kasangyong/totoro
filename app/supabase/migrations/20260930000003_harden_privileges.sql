-- 1b 평가 반영: 스키마별 default privilege로는 PUBLIC의 함수 EXECUTE가 빠지지 않는다 → 함수마다 명시적으로 회수.
-- 필요한 권한만 다시 준다.

revoke execute on all functions in schema private from public, anon, authenticated;
revoke execute on all functions in schema public from public, anon, authenticated;

grant execute on function public.claim_attendance(), public.claim_rescue() to authenticated;
grant execute on function public.verify_invite_code(text) to service_role;
grant execute on function private.table_buyin(uuid, uuid, bigint), private.table_cashout(uuid, uuid, bigint) to engine_rw;

-- 테이블: 읽기만 남긴다 (TRUNCATE·TRIGGER·REFERENCES 포함 전부 회수 후 select만 부여).
revoke all on public.profiles, public.ledger from anon, authenticated;
grant select on public.profiles, public.ledger to authenticated;
revoke all on public.rooms, public.room_seats, public.room_events, public.hands from anon, authenticated;
grant select on public.rooms, public.room_seats, public.room_events, public.hands to authenticated;
revoke all on all sequences in schema public from anon, authenticated;

-- 청소 함수: 판 무효 처리 후 상태를 통째로 덮어쓰지 않고 phase만 바꾼다 (조회가 다른 필드를 그대로 읽을 수 있게).
create or replace function private.close_abandoned_rooms() returns int
language plpgsql security definer set search_path = ''
as $$
declare
  r record;
  s record;
  n int := 0;
begin
  for r in
    select rs.room_id from private.room_state rs
    join public.rooms ro on ro.id = rs.room_id
    where ro.status <> 'closed' and ro.last_activity_at < now() - interval '10 minutes'
    order by rs.room_id
    for update of rs skip locked
  loop
    if not exists (select 1 from public.rooms where id = r.room_id and status <> 'closed'
                   and last_activity_at < now() - interval '10 minutes') then
      continue;
    end if;
    update public.hands set status = 'void', ended_at = now() where room_id = r.room_id and status = 'playing';
    for s in select * from public.room_seats where room_id = r.room_id order by seat_no for update loop
      perform private.table_cashout(s.user_id, s.seat_session_id, coalesce(s.hand_start_stack, s.stack));
    end loop;
    delete from public.room_seats where room_id = r.room_id;
    update public.rooms set status = 'closed' where id = r.room_id;
    update private.room_state
      set seq = seq + 1,
          state = state || jsonb_build_object('phase', 'closed', 'game', null, 'players', '[]'::jsonb),
          deadline = null
      where room_id = r.room_id;
    insert into public.room_events (room_id, seq, kind)
      select r.room_id, seq, 'closed' from private.room_state where room_id = r.room_id;
    n := n + 1;
  end loop;
  return n;
end;
$$;
revoke execute on function private.close_abandoned_rooms() from public, anon, authenticated;
