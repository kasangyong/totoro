-- R6: 7포커 방 허용
alter table public.rooms drop constraint rooms_game_check;
alter table public.rooms add constraint rooms_game_check check (game in ('sutda', 'poker7'));
