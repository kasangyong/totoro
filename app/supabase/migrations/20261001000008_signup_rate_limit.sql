-- 배포 체크리스트: /api/signup 요청 횟수 제한 (IP당 1시간 5번). 서버리스에서도 동작하도록 DB에 기록한다.
create table private.signup_attempts (
  id bigint generated always as identity primary key,
  ip text not null,
  at timestamptz not null default now()
);
create index signup_attempts_ip_at on private.signup_attempts (ip, at desc);

create function public.signup_rate_ok(p_ip text) returns boolean
language plpgsql volatile security definer set search_path = ''
as $$
declare
  n int;
begin
  -- 같은 IP의 동시 요청을 줄 세워서 한도를 넘지 않게
  perform pg_advisory_xact_lock(hashtext('signup:' || p_ip));
  delete from private.signup_attempts where at < now() - interval '1 day';
  select count(*) into n from private.signup_attempts where ip = p_ip and at > now() - interval '1 hour';
  if n >= 5 then return false; end if;
  insert into private.signup_attempts (ip) values (p_ip);
  return true;
end;
$$;

revoke execute on function public.signup_rate_ok(text) from public, anon, authenticated;
grant execute on function public.signup_rate_ok(text) to service_role;
