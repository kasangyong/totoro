-- 텍사스 홀덤 방 — holdem-arch.md 결정 4. BB = 기본금, SB = 절반(내림)이라 기본금은 2 이상.
alter table public.rooms drop constraint rooms_game_check;
alter table public.rooms add constraint rooms_game_check check (game in ('sutda', 'sutda3', 'poker7', 'blackjack', 'holdem'));
alter table public.rooms add constraint rooms_holdem_base_bet check (game <> 'holdem' or base_bet >= 2);
