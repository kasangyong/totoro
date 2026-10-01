-- 블랙잭 방 — blackjack-arch.md 결정 1·6.
-- 하우스 정산은 스택만 바꾸고 기록을 남긴다 (원장·지갑은 일어설 때 table_cashout으로만).

alter table public.rooms drop constraint rooms_game_check;
alter table public.rooms add constraint rooms_game_check check (game in ('sutda', 'poker7', 'blackjack'));
-- 3:2를 정수로 정확히 주려고 베팅은 짝수만 → 기본금도 짝수, 10P 이상
alter table public.rooms add constraint rooms_blackjack_base_bet
  check (game <> 'blackjack' or (base_bet >= 10 and base_bet % 2 = 0));

create table private.house_settlements (
  hand_id uuid not null references public.hands (id),
  user_id uuid not null references public.profiles (id),
  seat_session_id uuid not null,
  bet_total bigint not null check (bet_total >= 0),
  delta bigint not null,
  kind text not null check (kind in ('settle', 'void')),
  created_at timestamptz not null default now(),
  primary key (hand_id, user_id)
);
alter table private.house_settlements enable row level security;
revoke all on private.house_settlements from public, anon, authenticated, engine_rw;

-- 판 정산: 그 판 참가 좌석(hand_start_stack is not null) 전부를 한 번에.
-- p_rows = [{user_id, bet_total, delta}], 좌석과 정확히 일치해야 하고 bet_total = hand_contrib.
create function private.settle_blackjack_hand(p_hand uuid, p_rows jsonb)
returns table (user_id uuid, stack bigint)
language plpgsql security definer set search_path = ''
as $$
#variable_conflict use_column
declare
  v_room uuid;
  s record;
  r jsonb;
  v_bet bigint;
  v_delta bigint;
  n int := 0;
begin
  select h.room_id into v_room from public.hands h
    join public.rooms ro on ro.id = h.room_id
    where h.id = p_hand and h.status = 'playing' and ro.game = 'blackjack';
  if not found then
    raise exception 'hand is not a playing blackjack hand' using errcode = 'P0006';
  end if;
  for s in
    select * from public.room_seats rs
    where rs.room_id = v_room and rs.hand_start_stack is not null
    order by rs.seat_no for update
  loop
    select e into r from jsonb_array_elements(p_rows) e where (e ->> 'user_id')::uuid = s.user_id;
    if r is null then
      raise exception 'missing settlement row' using errcode = 'P0006';
    end if;
    v_bet := (r ->> 'bet_total')::bigint;
    v_delta := (r ->> 'delta')::bigint;
    if v_bet is null or v_delta is null then
      raise exception 'settlement out of range' using errcode = 'P0006';
    end if;
    if v_bet <> s.hand_contrib or v_bet > s.hand_start_stack or v_delta < -v_bet or 2 * v_delta > 3 * v_bet then
      raise exception 'settlement out of range' using errcode = 'P0006';
    end if;
    update public.room_seats rs2
      set stack = s.hand_start_stack + v_delta, hand_start_stack = null, hand_contrib = 0
      where rs2.seat_session_id = s.seat_session_id;
    insert into private.house_settlements (hand_id, user_id, seat_session_id, bet_total, delta, kind)
      values (p_hand, s.user_id, s.seat_session_id, v_bet, v_delta, 'settle');
    user_id := s.user_id;
    stack := s.hand_start_stack + v_delta;
    n := n + 1;
    return next;
  end loop;
  if n <> jsonb_array_length(p_rows) then
    raise exception 'unknown seat in settlement' using errcode = 'P0006';
  end if;
end;
$$;
revoke execute on function private.settle_blackjack_hand(uuid, jsonb) from public, anon, authenticated;
grant execute on function private.settle_blackjack_hand(uuid, jsonb) to engine_rw;

-- 청소: 블랙잭 판 도중 방치되면 걸린 금액(hand_contrib)은 몰수 (판을 무르는 악용 방지, 결정 1).
-- 섯다·포커는 그대로 판 시작 스택 반환.
create or replace function private.close_abandoned_rooms() returns int
language plpgsql security definer set search_path = ''
as $$
declare
  r record;
  s record;
  v_hand uuid;
  n int := 0;
begin
  for r in
    select rs.room_id, ro.game from private.room_state rs
    join public.rooms ro on ro.id = rs.room_id
    where ro.status <> 'closed' and ro.last_activity_at < now() - interval '10 minutes'
    order by rs.room_id
    for update of rs skip locked
  loop
    if not exists (select 1 from public.rooms where id = r.room_id and status <> 'closed'
                   and last_activity_at < now() - interval '10 minutes') then
      continue;
    end if;
    select id into v_hand from public.hands where room_id = r.room_id and status = 'playing';
    update public.hands set status = 'void', ended_at = now() where room_id = r.room_id and status = 'playing';
    for s in select * from public.room_seats where room_id = r.room_id order by seat_no for update loop
      if r.game = 'blackjack' and s.hand_start_stack is not null and v_hand is not null then
        insert into private.house_settlements (hand_id, user_id, seat_session_id, bet_total, delta, kind)
          values (v_hand, s.user_id, s.seat_session_id, s.hand_contrib, -s.hand_contrib, 'void');
        perform private.table_cashout(s.user_id, s.seat_session_id, s.hand_start_stack - s.hand_contrib);
      else
        perform private.table_cashout(s.user_id, s.seat_session_id, coalesce(s.hand_start_stack, s.stack));
      end if;
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
