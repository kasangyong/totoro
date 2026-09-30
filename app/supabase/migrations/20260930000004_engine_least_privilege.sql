-- R3 평가 반영: 엔진이 쓰지 않는 삭제 권한 회수.
-- rooms를 지우면 room_seats가 cascade로 반환 없이 사라지므로, 방은 status='closed'로만 닫는다.
revoke delete on public.rooms, public.hands from engine_rw;
