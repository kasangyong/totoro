-- 평가 반영: 다른 사람의 Crash 베팅(특히 자동 캐시아웃 설정)은 그 라운드가 터진 뒤에만 보인다.
drop policy "crash bets readable" on public.crash_bets;
create policy "crash bets: own, or after the round crashed" on public.crash_bets
  for select to authenticated
  using (
    user_id = auth.uid()
    or exists (select 1 from public.crash_rounds r where r.id = round_id and r.status = 'crashed')
  );
