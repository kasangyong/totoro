# 설계 — 멀티 방 + 섯다 · 7포커

- 작성일: 2026-09-30 (rev.2 — 평가 1차 "위험" 반영)
- 관련: [product-brief](../product-brief.md) · [서비스 설계](betting-site-arch.md) · [게임 규칙](card-games-rules.md) · [HANDOFF §7](../../HANDOFF.md)
- 규모 가정: 사용자 ≤10명, 동시 방 ≤3, 방당 ≤6명. 턴제라 초당 요청 수는 무시 가능.
- 범위: 방 게임(섯다·7포커)에만 적용. 기존 8개 단판 게임은 서비스 설계 그대로 (통일 여부는 나중에 재검토).

## 서비스 설계 전역 원칙의 예외 (명문화)
- **원칙 1 예외:** 방 게임은 Node(Route Handler) 트랜잭션 안에서 상태를 바꾼다. 단, **원장(ledger)·지갑(profiles)은 직접 쓰지 않고** `private.table_buyin(user, room, seat_session, amount)` / `private.table_cashout(user, room, seat_session, amount)` 함수 **호출만** 한다 (내부에서 `_apply_ledger` 사용 → 음수 검사·unique 유지).
- 나머지 원칙(비밀값 private, 시각은 DB `now()`, 정수 포인트, DB 제약으로 이중 지급 차단)은 그대로.

---

## 결정 1. 게임 엔진 위치

| 옵션 | 장점 | 단점 |
|---|---|---|
| A. 전부 PL/pgSQL | 한 트랜잭션, 경로 단순 | 족보 판정·사이드팟을 SQL로 짜기 매우 어려움, 검증 페이지용 TS 이중 구현 |
| **B. TS 순수 엔진 + Route Handler에서 DB 트랜잭션 1개** | Vitest로 철저히 테스트, **같은 코드를 검증 페이지에서 재사용** | DB 직접 접속, 콜드스타트 |
| C. Supabase Edge Function(Deno) | DB와 가까움 | 런타임 추가, 코드 공유 번거로움 |

**추천: B.**
- 엔진 = `packages/engine` 순수 함수 `reduce(state, action) → { state, effects }`. 부수효과 없음, 시각은 action에 담겨 들어옴.
- **시드는 private state 안에 보관**(`state.secrets.server_seed`, `client_seeds`)하고 reduce가 딜·재경기 셔플을 직접 수행 → `replay(seeds, action_log)`는 같은 reduce를 처음부터 다시 돌리기만 하면 됨. 공개 응답은 `viewFor`가 `secrets`를 제거.
- `POST /api/rooms/[id]/action`:
  1. `auth.getUser()`로 사용자 확인 (body의 user id 무시). 행동 주체 = 그 사용자의 좌석.
  2. `postgres(url, { prepare: false, max: 1, idle_timeout: 20 })`, Supavisor **트랜잭션 모드 포트 6543**. Vercel 함수 리전 = Supabase 리전.
  3. `BEGIN` → `SELECT now()` → `room_state FOR UPDATE` → `room_seats`(해당 방) `FOR UPDATE` → `expected_seq` 확인(다르면 409) → `reduce` → 저장 → (필요 시) buyin/cashout 함수 호출 → 이벤트 insert → `COMMIT`.
- **잠금 순서 고정:** `room_state` → `room_seats`(seat_no 오름차순) → `profiles`(user_id 오름차순, cashout 함수 내부). 데드락 방지.
- `now()`는 트랜잭션 시작 시각. 잠금을 기다린 요청과 tick의 경합은 `expected_seq` 409로 정리.

### DB 역할 `engine_rw`
- 허용: `private.room_state`, `private.hand_secrets`, `public.rooms`, `public.room_seats`, `public.room_events`, `public.hands`의 select/insert/update, `private.table_buyin`/`table_cashout` EXECUTE.
- 금지: `ledger`·`profiles` 직접 쓰기, `BYPASSRLS`, 그 외 테이블.
- 비밀번호는 Vercel 환경변수에만. 저장소가 public이므로 `.env*`는 `.gitignore` 확인 후 절대 커밋하지 않음.

---

## 결정 2. 실시간 전달

| 옵션 | 장점 | 단점 |
|---|---|---|
| **A. 공개 이벤트 테이블 + postgres_changes 구독 → 내 상태 재조회** | 서버만 insert → 위조 불가, 비밀값이 채널에 안 실림 | 이벤트마다 조회 1회 |
| B. Broadcast로 상태 전송 | 지연 최소 | 위조 가능, 개인 패 전송 불가 |
| C. 폴링만 | 단순 | 지연·egress |

**추천: A.**
- `public.room_events(id, room_id, seq, kind, public_payload, created_at)`: **insert-only, 절대 삭제·수정 안 함** (DELETE 이벤트는 RLS 필터가 안 됨). RLS select = 로그인 사용자.
- `supabase_realtime` publication에 `room_events`만 추가, 구독 필터 `room_id=eq.{id}`.
- 클라이언트: 이벤트 수신 → `GET /api/rooms/[id]/state` (본인 시점). 응답에 `seq`, `server_now` 포함.
- **전달 보장 없음 → 받은 seq에 공백이 있거나 재접속하면 전체 상태 재조회.** 5초마다 가벼운 `seq` 확인(보조).
- Presence는 "접속 중" 표시만. 판정에 사용 안 함.

---

## 결정 3. 남의 패 숨기기

| 옵션 | 장점 | 단점 |
|---|---|---|
| **A. 서버 보관 + 본인 시점 필터링** | 구현 쉬움 | 운영자는 진행 중 패 열람 가능 |
| B. Mental poker | 운영자도 못 봄 | 구현 매우 어려움, 이탈 시 패 못 엶, 10명엔 과함 |

**추천: A.**
- 덱·패·버린 카드·히든·**초이스 선택(전원 확정 전)** 은 `private.room_state.state`에만.
- 상태 응답은 반드시 엔진 `viewFor(state, userId)`를 거침 → 남의 비공개 정보는 `null`. 관전자 = 공개 정보만.
- 판 종료 시 검증을 위해 **전체 덱이 공개되므로 다이한 사람의 패도 드러남** → 규칙 문서·UI에 고지.
- **관리자(운영자)는 카드 방 착석 금지** (관전만 가능). 운영자는 DB에서 시드·패를 볼 수 있어 참가하면 공정성이 깨지기 때문 (결정 4 참고).
- 한계 고지(검증 페이지): "운영자는 진행 중 패를 볼 수 있고, 다른 계정으로 참가할 수도 있다. 덱 순서는 판 시작 전 커밋되어 사후에 바꿀 수 없다." 더 강하게 하려면 client_seed 2단계 커밋(해시 먼저) — RNG 규격 변경 없이 R3에서 추가 가능.

---

## 결정 4. 투명성 (섞기 검증)

| 옵션 | 장점 | 단점 |
|---|---|---|
| **A. 서버 시드 커밋 → 참가자 시드 수집 → 결합 셔플 → 판 종료 후 공개** | 서버 혼자 덱을 못 정함, 사후 재계산 | 운영자 열람 한계(결정 3) |
| B. 서버 시드만 | 단순 | 서버가 덱을 골랐다는 의심 |

**추천: A** + 관리자 착석 금지(운영자가 시드를 보고 자기 client_seed를 골라 덱을 맞추는 공격 차단).

### 흐름
1. 판 준비: 서버가 `server_seed`(32바이트) 생성 → `commit = hex(SHA-256(server_seed))` **공개 이벤트로 먼저 발행**.
2. 참가자 브라우저가 `client_seed`(16바이트 랜덤) 생성 → **로컬에 보관**하고 서버로 전송. 기한(5초) 내 미제출 시 서버가 auto 시드로 채우고 `auto=true` 기록 (검증 페이지에 "자동" 표시).
3. 셔플(아래 규격) → 딜.
4. 판 종료: `server_seed`, 각 `client_seed`(+auto 여부), 액션 로그 공개.
5. 검증 페이지 `/verify/hand/[id]`: 해시 확인 → 같은 엔진으로 셔플 재현 → 액션 로그 재생 → 결과 일치 표시. **내 브라우저에 보관한 client_seed와 서버가 쓴 값이 같은지 자동 대조.**

### RNG 규격 v1 (엔진·검증 페이지 공통, 변경 시 v2로)
| 항목 | 정의 |
|---|---|
| server_seed | 32바이트. 표기는 소문자 hex 64자 |
| client_seed | 16바이트. 소문자 hex 32자, **`^[0-9a-f]{32}$` 아니면 거부**. auto = `hex(SHA-256("auto|" + hand_id + "|" + user_id))`의 앞 32자 |
| seed_material | 참가자를 user_id 문자열 오름차순 정렬 → `user_id + "=" + client_seed` 를 `","`로 연결 |
| 블록 | `HMAC-SHA256(key = server_seed 바이트, msg = UTF-8("v1|" + hand_id + "|r" + rematch_no + "|" + seed_material + "|" + counter))`, counter는 0부터 10진수 |
| uint32 스트림 | 블록 32바이트를 4바이트씩 **big-endian** uint32 8개로, 다 쓰면 counter+1 |
| 균등 정수 `uniform(n)` | `limit = 2^32 − (2^32 mod n)`, x ≥ limit이면 버리고 다음 값, 아니면 `x mod n` |
| 셔플 | Fisher–Yates: `i = len−1` 부터 `1` 까지, `j = uniform(i+1)`, `swap(a[i], a[j])` |
| 재경기 | `rematch_no`를 1, 2, 3…으로 올려 도메인 분리, counter는 0부터 다시. 같은 server_seed·client_seeds 사용 |
| 초기 덱 순서 | 섯다: 1월 특수, 1월 일반, 2월 특수, … 10월 일반 (0~19). 포커: ♠2…♠A, ♦2…♦A, ♥2…♥A, ♣2…♣A (0~51) |

**테스트 벡터** (Node `crypto`로 계산):
- server_seed = `01` × 32바이트, hand_id = `h1`, rematch_no = 0, 참가자 `a`=`00`×16, `b`=`ff`×16
- seed_material = `a=00000000000000000000000000000000,b=ffffffffffffffffffffffffffffffff`
- 첫 uint32 4개 = `1333967691, 654985159, 3615548580, 2286357061`
- 20장(0~19) 셔플 결과 = `8,19,15,3,6,4,13,9,7,17,16,10,5,18,1,12,14,0,2,11`

---

## 결정 5. 칩 모델 (지갑과 테이블)

| 옵션 | 장점 | 단점 |
|---|---|---|
| A. 지갑으로 바로 베팅 | 단순 | 판 중 다른 게임으로 잔액이 바뀌어 사이드팟 계산 흔들림 |
| **B. 착석 시 바이인 → 테이블 스택, 일어설 때 반환** | 판 중 스택 고정, 결정적 | 원장 kind 2개 추가 |

**추천: B.**
- 원장 kind: `table_buyin`(−), `table_cashout`(+), `ref_id = 'seat:{seat_session_id}'` (착석마다 새 uuid → 착석 1회당 바이인·반환 각 1번).
- 바이인: 기본금 × 10 이상 ~ 보유 전부.
- **스택의 단일 원천 = `room_seats.stack`과 `room_seats.hand_contrib`(이번 판 누적 기여).** `room_state.state`에는 카드·턴·팟 구조만 두고, 엔진은 트랜잭션 안에서 좌석 행을 읽어 상태에 합친 뒤 결과를 좌석 행에 다시 씀.
- 보존 불변식: `Σ원장 = Σ지갑 + Σ스택 + Σhand_contrib` → 테스트와 관리자 점검 쿼리로 확인.
- 나머지 처리: 균등 분배·사이드팟의 나머지 포인트는 **좌석 번호가 가장 낮은 수령자에게** (소멸 없음). 규칙 문서도 동일하게 수정.

---

## 결정 6. 턴 타이머와 방치된 방

| 옵션 | 장점 | 단점 |
|---|---|---|
| **A. `turn_deadline` 저장 + 참가자 클라이언트의 `tick` 호출 + `pg_cron` 1분 청소** | 상주 서버 불필요, 멈춤 없음 | 청소는 판 무효 처리(SQL) |
| B. `pg_cron`만으로 진행 | 확실 | 1초 단위 불가, TS 엔진을 cron에서 못 돌림 |

**추천: A.**
- **tick:** 참가자 클라이언트가 `turn_deadline + 0.3초`(`server_now`로 시각 보정)에 `POST /api/rooms/[id]/tick`. 서버는 잠금 후 `now() >= turn_deadline`일 때만 자동 액션 → 여러 명이 불러도 1번.
- **자동 액션도 액션 로그에 `timeout`으로 기록** (검증 재생 가능). 결정성은 로그된 액션 순서만으로 성립하고 수신 시각에 의존하지 않음.
- **밀린 tick은 현재 판 종료까지만 처리**, 새 판을 자동으로 연속 시작하지 않음.
- **한 판 동안 본인 액션이 하나도 없던 좌석**(전부 timeout)은 판 종료 시 자동으로 일어섬 → 스택 반환.
- 다음 판: 판 종료 5초 후, 앉아 있는 사람 2명 이상이면 시작. 이때 `room_seats.last_seen_at`이 최근 60초 안인 좌석만 참가(나머지는 일어섬·반환).
- 갱신 규칙: `last_seen_at` = 그 좌석 사용자의 state 조회·action·tick마다 (state GET은 이 컬럼 하나만 씀, 30초에 1번으로 제한). `rooms.last_activity_at` = action·tick·착석·일어서기마다.
- **방치된 방 청소 (`pg_cron` 매 1분, SQL만):** `rooms.last_activity_at < now() − 10분`이고 `closed`가 아니면 `private.close_abandoned_room(room)` — 엔진과 **같은 잠금 순서**(`room_state FOR UPDATE` → `room_seats` → `profiles`), 잠근 뒤 조건 재확인, 끝에 `room_state.seq` 증가 + 종료 상태 기록(늦게 온 action/tick은 409):
  1. 진행 중 판 **무효**: 각 좌석 `stack += hand_contrib`, `hand_contrib = 0` (팟 반환), 판 결과 `void` 기록.
  2. 전 좌석 `table_cashout(stack)` → 좌석 비움.
  3. `rooms.status = 'closed'`, 이벤트 발행.
  - TS 엔진 불필요 (좌석 행에 스택·기여가 있으므로).

---

## 결정 7. 방 생명주기

- 방 만들기: 게임(`sutda` | `poker7`), 기본금, 최대 인원(2~6). **공개 방만** (친구 10명이라 비공개 코드 불필요, 코드 해시 역산 문제 회피).
- 상태: `waiting` → (2명 이상 착석 + 방장 시작) → `playing` → 전원 이탈·청소 시 `closed`.
- 방장 이탈 시 좌석 번호가 가장 낮은 사람이 방장.
- 중간 이탈: 자기 턴에 timeout 규칙 → 판 종료 시 일어섬·반환.
- 관전: 누구나, 공개 정보만. 관리자는 관전만.
- 동시 액션: `expected_seq` 불일치 → 409 → 상태 재조회.

---

## 데이터 모델

| 테이블 | 스키마 | 내용 | 쓰기 |
|---|---|---|---|
| `rooms` | public | id, game, base_bet, max_seats, host_id, status, last_activity_at | `engine_rw`만 (클라이언트 insert/update 정책 없음) |
| `room_seats` | public | room_id, seat_no, user_id, seat_session_id, stack, hand_contrib, status(`sitting`,`away`), last_seen_at. unique `(room_id, seat_no)`, unique `(room_id, user_id)` | `engine_rw`만 |
| `room_events` | public | room_id, seq, kind, public_payload | `engine_rw`만 insert, 삭제·수정 금지 |
| `hands` | public | id, room_id, hand_no, commit_hash, status, result, revealed(jsonb, 종료 후에만 채움) | `engine_rw`만 |
| `room_state` | private | room_id, seq, state(jsonb), turn_deadline | `engine_rw`만 |
| `hand_secrets` | private | hand_id, server_seed, client_seeds, action_log | `engine_rw`만 |

- 공개 테이블 RLS: select = 로그인 사용자, **insert/update/delete 정책 없음**.
- 방 만들기·착석·일어서기도 전부 Route Handler(엔진 트랜잭션) 경유.

---

## 엔진 모듈 구조

```
packages/engine/
  rng.ts          RNG 규격 v1 (테스트 벡터 포함)
  betting.ts      한국식 베팅, 라운드 종료, 올인·사이드팟, 나머지 배분
  sutda/          덱, 족보, 잡기 반복 판정, 재경기, reduce
  poker7/         덱, 7장 중 5장 판정, 동점, 보스, 초이스(동시 선택), reduce
  view.ts         viewFor(state, userId)
  replay.ts       (seeds, action_log) → 최종 결과 (검증 페이지)
```

테스트(Vitest):
- RNG 테스트 벡터 일치.
- 섯다 족보 전수 비교표, 규칙 문서 예시, 구사 재경기 조건.
- 7포커: 알려진 핸드 세트 + 무작위 7장 10만 개 순위 전이성.
- 베팅: 레이즈 3회, 전원 체크 종료, 삥 후 전원 콜 종료, 올인 사이드팟(스택 3종), 나머지 배분.
- 보존: 임의 액션 시퀀스 후 `Σ스택 + Σhand_contrib` 불변.
- 결정성: 같은 시드 + 같은 로그 → 같은 결과 (`replay`).
- `viewFor`: 모든 시점에서 남의 비공개 카드·미확정 초이스가 응답에 없음 (속성 테스트).

---

## 구현 단계 (각 단계 후 평가 → 통과 시 다음)

전제: 서비스 설계 1단계(셋업·가입·원장)가 먼저 끝나 있어야 함.

| 단계 | 내용 | 완료 기준 |
|---|---|---|
| R1 | 엔진 공통(rng, betting, view, replay) + 테스트 | 테스트 벡터·베팅·보존·결정성 통과 |
| R2 | 섯다 엔진 + 테스트 | 족보 전수표·특수패·재경기 통과 |
| R3a | 테이블·RLS·`engine_rw` 권한·buyin/cashout 함수·청소 함수 | 권한 테스트(클라이언트 쓰기 전부 실패, `engine_rw`로 ledger 직접 쓰기 실패), 청소 후 보존 불변식 |
| R3b | action/state/tick API·Realtime 구독 | 브라우저 2개로 섯다 1판 완주, 남의 패 응답에 없음, 동시 tick 1회만 |
| R4 | 섯다 UI (데모 테마 재사용) + 검증 페이지 | 판 종료 후 "일치", 내 시드 대조 성공 |
| R5 | 7포커 엔진 + 테스트 | 족보·동점·보스·초이스 숨김 통과 |
| R6 | 7포커 UI | 브라우저 3개로 초이스→히든→쇼다운 완주 |

---

## Open questions
1. 기존 8개 단판 게임의 엔진 통일 → 방 게임 완성 후 재검토.
2. 패키지 매니저: npm으로 진행 (설치돼 있음).
