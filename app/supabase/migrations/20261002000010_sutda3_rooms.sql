-- 3장 섯다 방 — sutda3-arch.md 결정 3. 게임 종류 값만 늘린다 (엔진 상태는 game 'sutda' + variant 3).
alter table public.rooms drop constraint rooms_game_check;
alter table public.rooms add constraint rooms_game_check check (game in ('sutda', 'sutda3', 'poker7', 'blackjack'));
