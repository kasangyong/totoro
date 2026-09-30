-- 1b: 프로필 · 포인트 원장 · 설정 · 가입 보너스 · 출석/구제금
-- 원칙 (docs/design/betting-site-arch.md): 돈 로직은 private 스키마, 호출 창구는 public 래퍼(SECURITY DEFINER, auth.uid()),
-- 클라이언트는 profiles/ledger에 직접 쓸 수 없다. 이중 지급은 ledger unique(user_id, kind, ref_id)로 막는다.

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

-- Supabase는 public에 새로 만드는 함수에 anon/authenticated EXECUTE를 기본으로 준다 → 기본값부터 끈다.
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;
alter default privileges in schema private revoke all on tables from public, anon, authenticated;
alter default privileges in schema private revoke execute on functions from public, anon, authenticated;

-- ── 설정 ────────────────────────────────────────────────
create table private.settings (
  key text primary key,
  value jsonb not null
);

insert into private.settings (key, value) values
  ('invite_code', '"totoro"'),
  ('signup_bonus', '10000'),
  ('attendance_bonus', '500'),
  ('rescue_amount', '1000'),
  ('rescue_threshold', '100');

create function private.setting_int(k text) returns bigint
language sql stable security definer set search_path = ''
as $$ select (value #>> '{}')::bigint from private.settings where key = k $$;

-- ── 프로필 ──────────────────────────────────────────────
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text not null unique check (username ~ '^[a-z0-9_]{3,16}$'),
  role text not null default 'user' check (role in ('admin', 'user')),
  balance bigint not null default 0 check (balance >= 0),
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
create policy "profiles are readable by signed-in users" on public.profiles
  for select to authenticated using (true);
revoke insert, update, delete on public.profiles from anon, authenticated;

-- ── 원장 ────────────────────────────────────────────────
create table public.ledger (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  delta bigint not null,
  kind text not null check (kind in (
    'signup_bonus', 'bet', 'payout', 'refund', 'daily_rescue', 'attendance', 'mission',
    'table_buyin', 'table_cashout'
  )),
  ref_id text not null,
  balance_after bigint not null,
  created_at timestamptz not null default now(),
  unique (user_id, kind, ref_id)
);

create index ledger_user_created on public.ledger (user_id, created_at desc);

alter table public.ledger enable row level security;
create policy "users read their own ledger" on public.ledger
  for select to authenticated using (user_id = auth.uid());
revoke insert, update, delete on public.ledger from anon, authenticated;

-- 모든 포인트 증감의 유일한 경로. 다른 private 함수 안에서만 호출된다.
create function private._apply_ledger(p_user uuid, p_delta bigint, p_kind text, p_ref text)
returns bigint
language plpgsql security definer set search_path = ''
as $$
declare
  v_balance bigint;
begin
  select balance into v_balance from public.profiles where id = p_user for update;
  if not found then
    raise exception 'unknown user' using errcode = 'P0002';
  end if;
  if v_balance + p_delta < 0 then
    raise exception 'insufficient balance' using errcode = 'P0001';
  end if;
  v_balance := v_balance + p_delta;
  insert into public.ledger (user_id, delta, kind, ref_id, balance_after)
    values (p_user, p_delta, p_kind, p_ref, v_balance);
  update public.profiles set balance = v_balance where id = p_user;
  return v_balance;
end;
$$;

-- ── 가입 ────────────────────────────────────────────────
-- 가입은 /api/signup(service role)에서만: 초대코드 확인 → auth.admin.createUser → 이 트리거가 프로필과 보너스를 만든다.
create function private.handle_new_user() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.profiles (id, username)
    values (new.id, lower(new.raw_user_meta_data ->> 'username'));
  perform private._apply_ledger(new.id, private.setting_int('signup_bonus'), 'signup_bonus', 'signup');
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

create function public.verify_invite_code(p_code text) returns boolean
language sql stable security definer set search_path = ''
as $$ select exists (select 1 from private.settings where key = 'invite_code' and value #>> '{}' = p_code) $$;

revoke execute on function public.verify_invite_code(text) from public, anon, authenticated;
grant execute on function public.verify_invite_code(text) to service_role;

-- ── 출석 · 구제금 (KST 날짜 기준 하루 1번) ─────────────────
create function private.kst_today() returns text
language sql stable set search_path = ''
as $$ select to_char(now() at time zone 'Asia/Seoul', 'YYYY-MM-DD') $$;

create function public.claim_attendance() returns bigint
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then raise exception 'not signed in' using errcode = '42501'; end if;
  return private._apply_ledger(v_user, private.setting_int('attendance_bonus'), 'attendance', private.kst_today());
exception when unique_violation then
  raise exception 'already claimed today' using errcode = 'P0003';
end;
$$;

create function public.claim_rescue() returns bigint
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_balance bigint;
begin
  if v_user is null then raise exception 'not signed in' using errcode = '42501'; end if;
  select balance into v_balance from public.profiles where id = v_user;
  if v_balance >= private.setting_int('rescue_threshold') then
    raise exception 'balance too high for rescue' using errcode = 'P0004';
  end if;
  return private._apply_ledger(v_user, private.setting_int('rescue_amount'), 'daily_rescue', private.kst_today());
exception when unique_violation then
  raise exception 'already claimed today' using errcode = 'P0003';
end;
$$;

revoke execute on function public.claim_attendance() from public, anon;
revoke execute on function public.claim_rescue() from public, anon;
grant execute on function public.claim_attendance() to authenticated;
grant execute on function public.claim_rescue() to authenticated;
