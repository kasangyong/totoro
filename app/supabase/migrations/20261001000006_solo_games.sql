-- 혼자 하는 게임 8종 (Dice·Limbo·Wheel·Plinko·Mines·Chicken·HiLo + 공유 Crash)
-- 공정성: 사용자마다 서버 시드(해시 선공개)·클라이언트 시드·nonce. 시드를 바꾸면 이전 서버 시드 공개 → 지난 판 재계산.
-- 돈: 엔진(engine_rw)은 solo_bet / solo_payout 함수만 호출한다.

-- ── 시드 쌍 ──────────────────────────────────────────────
create table public.seed_pairs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  commit_hash text not null,
  client_seed text not null,
  -- 교체(공개)된 뒤에만 채운다
  server_seed text,
  created_at timestamptz not null default now(),
  revealed_at timestamptz
);
create index seed_pairs_user on public.seed_pairs (user_id, created_at desc);

create table private.user_seeds (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  seed_pair_id uuid not null references public.seed_pairs (id),
  server_seed text not null,
  client_seed text not null,
  nonce bigint not null default 0
);

-- ── 판 기록 (세션형 게임의 진행 중 상태 포함) ─────────────────
create table public.solo_bets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  game text not null check (game in ('dice', 'limbo', 'wheel', 'plinko', 'mines', 'chicken', 'hilo')),
  seed_pair_id uuid not null references public.seed_pairs (id),
  nonce bigint not null,
  stake bigint not null check (stake > 0),
  payout bigint check (payout >= 0),
  params jsonb not null,
  -- 공개 상태: 단판은 결과, 세션형은 지금까지 열린 칸·카드 등
  state jsonb not null default '{}'::jsonb,
  status text not null check (status in ('active', 'won', 'lost')),
  created_at timestamptz not null default now(),
  ended_at timestamptz,
  unique (seed_pair_id, nonce)
);
create index solo_bets_user on public.solo_bets (user_id, created_at desc);
create unique index solo_bets_one_active on public.solo_bets (user_id, game) where status = 'active';

-- 세션형 게임의 정답 (지뢰 위치, 사고 차선, 다음 카드들)
create table private.solo_secrets (
  bet_id uuid primary key references public.solo_bets (id) on delete cascade,
  secret jsonb not null
);

-- ── Crash (모두 같은 판) ──────────────────────────────────
create table public.crash_rounds (
  id uuid primary key default gen_random_uuid(),
  round_no bigint not null unique,
  commit_hash text not null,
  betting_ends_at timestamptz not null,
  status text not null check (status in ('running', 'crashed')),
  -- 터진 뒤에만 채운다
  crash_point100 int,
  crashed_at timestamptz,
  seed text,
  created_at timestamptz not null default now()
);

create table private.crash_secrets (
  round_id uuid primary key references public.crash_rounds (id) on delete cascade,
  seed text not null,
  crash_point100 int not null,
  crash_ms int not null
);

create table public.crash_bets (
  round_id uuid not null references public.crash_rounds (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  stake bigint not null check (stake > 0),
  auto100 int check (auto100 >= 101),
  cashout100 int,
  payout bigint,
  created_at timestamptz not null default now(),
  primary key (round_id, user_id)
);

-- ── 권한 ────────────────────────────────────────────────
alter table public.seed_pairs enable row level security;
alter table public.solo_bets enable row level security;
alter table public.crash_rounds enable row level security;
alter table public.crash_bets enable row level security;
alter table private.user_seeds enable row level security;
alter table private.solo_secrets enable row level security;
alter table private.crash_secrets enable row level security;

create policy "own seed pairs" on public.seed_pairs for select to authenticated using (user_id = auth.uid());
create policy "own solo bets" on public.solo_bets for select to authenticated using (user_id = auth.uid());
create policy "crash rounds readable" on public.crash_rounds for select to authenticated using (true);
create policy "crash bets readable" on public.crash_bets for select to authenticated using (true);

revoke all on public.seed_pairs, public.solo_bets, public.crash_rounds, public.crash_bets from anon, authenticated;
grant select on public.seed_pairs, public.solo_bets, public.crash_rounds, public.crash_bets to authenticated;

grant select, insert, update on public.seed_pairs, public.solo_bets, public.crash_rounds, public.crash_bets to engine_rw;
grant select, insert, update on private.user_seeds, private.solo_secrets, private.crash_secrets to engine_rw;
create policy "engine seed pairs" on public.seed_pairs for all to engine_rw using (true) with check (true);
create policy "engine solo bets" on public.solo_bets for all to engine_rw using (true) with check (true);
create policy "engine crash rounds" on public.crash_rounds for all to engine_rw using (true) with check (true);
create policy "engine crash bets" on public.crash_bets for all to engine_rw using (true) with check (true);
create policy "engine user seeds" on private.user_seeds for all to engine_rw using (true) with check (true);
create policy "engine solo secrets" on private.solo_secrets for all to engine_rw using (true) with check (true);
create policy "engine crash secrets" on private.crash_secrets for all to engine_rw using (true) with check (true);

-- ── 돈: 베팅 차감·지급 ────────────────────────────────────
create function private.solo_bet(p_user uuid, p_ref text, p_amount bigint) returns bigint
language plpgsql security definer set search_path = ''
as $$
begin
  if p_amount <= 0 then raise exception 'bad amount'; end if;
  return private._apply_ledger(p_user, -p_amount, 'bet', p_ref);
end;
$$;

create function private.solo_payout(p_user uuid, p_ref text, p_amount bigint) returns bigint
language plpgsql security definer set search_path = ''
as $$
begin
  if p_amount < 0 then raise exception 'bad amount'; end if;
  if p_amount = 0 then return (select balance from public.profiles where id = p_user); end if;
  return private._apply_ledger(p_user, p_amount, 'payout', p_ref);
end;
$$;

revoke execute on function private.solo_bet(uuid, text, bigint), private.solo_payout(uuid, text, bigint) from public, anon, authenticated;
grant execute on function private.solo_bet(uuid, text, bigint), private.solo_payout(uuid, text, bigint) to engine_rw;

-- Crash 실시간 표시는 폴링으로 하므로 publication에 넣지 않는다.
