-- R3a: 멀티 방 (docs/design/rooms-arch.md)
-- 공개 테이블은 로그인 사용자가 읽기만 한다. 쓰기는 엔진 역할(engine_rw)만, 원장은 table_buyin/table_cashout 함수로만.

-- ── 엔진 역할 ────────────────────────────────────────────
-- 비밀번호는 저장소에 두지 않는다: 로컬은 scripts/with-local-env.mjs가, 배포는 대시보드에서 ALTER ROLE로 설정.
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'engine_rw') then
    create role engine_rw login noinherit nobypassrls;
  end if;
end $$;

grant usage on schema public, private to engine_rw;

-- ── 테이블 ──────────────────────────────────────────────
create table public.rooms (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 30),
  game text not null check (game in ('sutda')),
  base_bet bigint not null check (base_bet between 1 and 100000),
  max_seats int not null check (max_seats between 2 and 6),
  host_id uuid references public.profiles (id) on delete set null,
  status text not null default 'waiting' check (status in ('waiting', 'playing', 'closed')),
  created_at timestamptz not null default now(),
  last_activity_at timestamptz not null default now()
);

create table public.room_seats (
  room_id uuid not null references public.rooms (id) on delete cascade,
  seat_no int not null check (seat_no between 0 and 5),
  user_id uuid not null references public.profiles (id) on delete cascade,
  seat_session_id uuid not null default gen_random_uuid() unique,
  stack bigint not null check (stack >= 0),
  hand_contrib bigint not null default 0 check (hand_contrib >= 0),
  hand_start_stack bigint,
  status text not null default 'sitting' check (status in ('sitting', 'away')),
  last_seen_at timestamptz not null default now(),
  primary key (room_id, seat_no),
  unique (room_id, user_id)
);

create table public.room_events (
  id bigint generated always as identity primary key,
  room_id uuid not null references public.rooms (id) on delete cascade,
  seq bigint not null,
  kind text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index room_events_room_seq on public.room_events (room_id, seq);

create table public.hands (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms (id) on delete cascade,
  hand_no int not null,
  commit_hash text not null,
  status text not null default 'playing' check (status in ('playing', 'done', 'void')),
  result jsonb,
  -- 판이 끝난 뒤에만 채운다: server_seed, client_seeds, action_log
  revealed jsonb,
  created_at timestamptz not null default now(),
  ended_at timestamptz,
  unique (room_id, hand_no)
);

create table private.room_state (
  room_id uuid primary key references public.rooms (id) on delete cascade,
  seq bigint not null default 0,
  state jsonb not null,
  deadline timestamptz
);

create table private.hand_secrets (
  hand_id uuid primary key references public.hands (id) on delete cascade,
  server_seed text not null,
  client_seeds jsonb not null default '{}'::jsonb,
  action_log jsonb not null default '[]'::jsonb
);

-- ── 읽기 권한 (쓰기 정책 없음) ─────────────────────────────
alter table public.rooms enable row level security;
alter table public.room_seats enable row level security;
alter table public.room_events enable row level security;
alter table public.hands enable row level security;
alter table private.room_state enable row level security;
alter table private.hand_secrets enable row level security;

create policy "rooms readable" on public.rooms for select to authenticated using (true);
create policy "seats readable" on public.room_seats for select to authenticated using (true);
create policy "events readable" on public.room_events for select to authenticated using (true);
create policy "hands readable" on public.hands for select to authenticated using (true);

revoke insert, update, delete, truncate on public.rooms, public.room_seats, public.room_events, public.hands from anon, authenticated;
revoke all on public.rooms, public.room_seats, public.room_events, public.hands from anon;

-- 엔진은 RLS를 우회하지 않고 자기 전용 정책으로 쓴다.
grant select, insert, update, delete on public.rooms, public.room_seats, public.hands to engine_rw;
grant select, insert on public.room_events to engine_rw;
grant select, insert, update on private.room_state, private.hand_secrets to engine_rw;
grant select on public.profiles to engine_rw;

create policy "engine rooms" on public.rooms for all to engine_rw using (true) with check (true);
create policy "engine seats" on public.room_seats for all to engine_rw using (true) with check (true);
create policy "engine hands" on public.hands for all to engine_rw using (true) with check (true);
create policy "engine events" on public.room_events for all to engine_rw using (true) with check (true);
create policy "engine state" on private.room_state for all to engine_rw using (true) with check (true);
create policy "engine secrets" on private.hand_secrets for all to engine_rw using (true) with check (true);
create policy "engine reads profiles" on public.profiles for select to engine_rw using (true);

-- 관리자(운영자)는 카드 방에 앉을 수 없다 (시드를 볼 수 있으므로).
create function private.forbid_admin_seat() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if exists (select 1 from public.profiles where id = new.user_id and role = 'admin') then
    raise exception 'admins cannot sit at card tables' using errcode = 'P0005';
  end if;
  return new;
end;
$$;
create trigger room_seats_no_admin before insert or update of user_id on public.room_seats
  for each row execute function private.forbid_admin_seat();

-- ── 칩 이동: 원장은 이 두 함수로만 ─────────────────────────
create function private.table_buyin(p_user uuid, p_seat_session uuid, p_amount bigint) returns bigint
language plpgsql security definer set search_path = ''
as $$
begin
  if p_amount <= 0 then raise exception 'bad amount'; end if;
  return private._apply_ledger(p_user, -p_amount, 'table_buyin', 'seat:' || p_seat_session);
end;
$$;

create function private.table_cashout(p_user uuid, p_seat_session uuid, p_amount bigint) returns bigint
language plpgsql security definer set search_path = ''
as $$
begin
  if p_amount < 0 then raise exception 'bad amount'; end if;
  return private._apply_ledger(p_user, p_amount, 'table_cashout', 'seat:' || p_seat_session);
end;
$$;

revoke all on function private.table_buyin(uuid, uuid, bigint), private.table_cashout(uuid, uuid, bigint) from public;
grant execute on function private.table_buyin(uuid, uuid, bigint), private.table_cashout(uuid, uuid, bigint) to engine_rw;

-- ── 방치된 방 청소 (pg_cron 1분마다, SQL만) ─────────────────
-- 진행 중 판은 무효: 각 좌석을 판 시작 시점 스택으로 되돌리고 전액 반환한 뒤 방을 닫는다.
create function private.close_abandoned_rooms() returns int
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
    -- 잠근 뒤 조건 재확인
    if not exists (select 1 from public.rooms where id = r.room_id and status <> 'closed'
                   and last_activity_at < now() - interval '10 minutes') then
      continue;
    end if;
    update public.hands set status = 'void', ended_at = now() where room_id = r.room_id and status = 'playing';
    for s in select * from public.room_seats where room_id = r.room_id order by seat_no for update loop
      -- hand_start_stack은 판 진행 중에만 채워져 있다 (판 중 스택은 room_state에만 있으므로 판 시작 값으로 되돌림).
      perform private.table_cashout(s.user_id, s.seat_session_id, coalesce(s.hand_start_stack, s.stack));
    end loop;
    delete from public.room_seats where room_id = r.room_id;
    update public.rooms set status = 'closed' where id = r.room_id;
    update private.room_state set seq = seq + 1, state = '{"phase":"closed"}'::jsonb, deadline = null
      where room_id = r.room_id;
    insert into public.room_events (room_id, seq, kind)
      select r.room_id, seq, 'closed' from private.room_state where room_id = r.room_id;
    n := n + 1;
  end loop;
  return n;
end;
$$;

create extension if not exists pg_cron;
select cron.schedule('close-abandoned-rooms', '* * * * *', 'select private.close_abandoned_rooms()');

-- ── 실시간 알림: 이벤트 테이블만 ──────────────────────────
alter publication supabase_realtime add table public.room_events;
