# 설계 — 친구용 베팅 게임 사이트

- 작성일: 2026-09-30 (rev.3 — 평가 1차 "위험", 2차 "보통" 지적 반영)
- 관련 brief: [../product-brief.md](../product-brief.md)
- 게임별 수식·배율표·UI 규칙: [../../HANDOFF.md](../../HANDOFF.md) §4 (데모가 기준, 서버 구현은 같은 수식을 따른다)
- 규모 가정: 사용자 ≤10명, 동시 접속 ≤10

## 전역 원칙 (모든 결정에 우선)
1. **돈을 움직이는 코드는 Postgres 함수 안에서만.** 게임 동작 1회 = RPC 1회 = 트랜잭션 1개. Node에서 여러 쿼리를 이어 붙여 돈을 처리하지 않는다.
2. **돈 로직은 `private` 스키마(PostgREST 비노출)**, 호출 창구는 **`public` 래퍼 함수**만.
   - 래퍼: `SECURITY DEFINER`, `SET search_path = ''`, `VOLATILE`. 사용자는 **인자로 받지 않고 `auth.uid()`로만** 특정 → 위조 불가.
   - `REVOKE EXECUTE … FROM public, anon`, `GRANT … TO authenticated`. 관리자 래퍼는 내부에서 `profiles.role='admin'` 검사.
   - private 함수·테이블은 `REVOKE ALL … FROM public, anon, authenticated`.
   - Supabase는 public 함수에 anon·authenticated EXECUTE를 기본 부여하므로 **모든 마이그레이션에서 REVOKE 명시**. 1단계 테스트: `pg_proc` 조회로 anon 실행 가능 public 함수 0개, 비-SECURITY DEFINER public 함수 0개 확인.
   - 결과: 게임 호출은 브라우저 → Supabase RPC(POST) 직행. Vercel Route Handler는 service role이 필요한 곳만: `/api/signup`, `/api/admin/reset-password`(role 검사).
3. **비밀값(시드·crash_point·지뢰 배치·카드 덱)은 `private` 스키마의 별도 테이블.** RLS는 행 단위라 컬럼을 숨기지 못하므로 공개 테이블에 비밀 컬럼을 두지 않는다.
4. **시각의 단일 기준 = Postgres `now()`.** 마감·캐시아웃·출석일 판정 모두 RPC 내부에서. 날짜는 `Asia/Seoul` 기준.
5. **포인트는 `bigint` 정수.** 배율 지급은 `floor(stake * multiplier)`.
6. **이중 지급은 DB 제약으로 막는다.** `ledger` unique `(user_id, kind, ref_id)`.

---

## 결정 1. 스택 / 호스팅

| 옵션 | 장점 | 단점 |
|---|---|---|
| **A. Next.js(App Router) on Vercel + Supabase(Postgres·Auth·Realtime)** | 배포 쉬움, 무료, Auth·Realtime 내장, Postgres 트랜잭션 | 상주 게임 루프 불가 → Crash를 시간 기반으로 설계 |
| B. Node(Fastify + Socket.io) 상주 서버 on Fly.io + Postgres | Crash 루프가 직관적 | 서버·DB·Auth 직접 운영 |
| C. Firebase | Realtime 쉬움 | 잔액 트랜잭션·랭킹 쿼리 불편 |

**추천: A.** 개발은 Supabase CLI 로컬 스택 + SQL 마이그레이션 + `supabase gen types`.
**리스크:** Supabase 무료 프로젝트 7일 비활성 시 일시정지 → Vercel Cron 일 1회 ping.

---

## 결정 2. 인증

| 옵션 | 장점 | 단점 |
|---|---|---|
| **A. 초대코드 + 아이디/비밀번호** | 친구들이 가장 쉽게 가입 | 비번 분실 시 관리자 리셋 |
| B. 이메일 매직링크 | 비번 없음 | 매번 메일 확인, SMTP 한도 |
| C. Discord/Kakao OAuth | 원클릭 | OAuth 앱 등록 번거로움 |

**추천: A.**
- Supabase Auth의 **"Allow new user signups" 끔** (anon key로 직접 `signUp` 우회 차단).
- 가입은 `POST /api/signup` 한 곳 (service role 사용):
  1. `public.verify_invite_code(code)` — `REVOKE … FROM public, anon, authenticated` 후 service_role에만 GRANT.
  2. `auth.admin.createUser({ email: '{id}@users.local.invalid', email_confirm: true })`.
  3. `auth.users` insert 트리거가 `profiles` 생성과 가입 보너스를 처리 (ledger unique로 1회 보장).
- `profiles.role = 'admin' | 'user'`. 관리자 기능: 비번 리셋, 초대코드 교체, 예측 확정.

---

## 결정 3. 포인트 모델

| 옵션 | 장점 | 단점 |
|---|---|---|
| A. `balance` 컬럼만 | 단순 | 이력 없음 |
| **B. `ledger` 원장 + `profiles.balance` 캐시** | 추적 가능, 랭킹 계산, 원자성 | 함수 설계 필요 |
| C. 원장만 (SUM) | 진실 원천 1개 | 동시성 제어 어려움 |

**추천: B.**
- 내부 헬퍼 `private._apply_ledger(user, delta, kind, ref_id)`: `SELECT … FOR UPDATE` → 음수면 예외 → ledger insert → balance update. **다른 private RPC 안에서만 호출.**
- `kind`: `signup_bonus | bet | payout | refund | daily_rescue | attendance | mission`.
- `profiles`: 본인·타인 모두 select만 허용(랭킹용), update 정책 없음.
- `ref_id text NOT NULL` (NULL이면 unique를 빠져나가므로 금지). 규칙:
  - `signup_bonus` → `'signup'`
  - `attendance`, `daily_rescue` → `'YYYY-MM-DD'` (KST)
  - `mission` → `'{mission_id}:YYYY-MM-DD'`
  - `bet`, `payout`, `refund` → `'{game}:{bet_or_session_id}'`
- unique `(user_id, kind, ref_id)` 하나로 모든 중복 지급 차단.

---

## 결정 4. RNG / provably fair

| 옵션 | 장점 | 단점 |
|---|---|---|
| **A. Stake 방식 HMAC-SHA256(server_seed, `client_seed:nonce:cursor`)** | 표준, 사용자 재계산 가능 | 시드 관리 필요 |
| B. `crypto.randomInt` + 로그 | 단순 | 증명 불가 |

**추천: A.**
- `public.user_seed_pairs(id, user_id, server_seed_hash, client_seed, nonce, revealed_seed, status)` + `private.seed_secrets(seed_pair_id, server_seed)`.
- **RNG 계산은 Postgres 안에서** (`pgcrypto`의 `hmac()`), 그래야 nonce 확보·결과 계산·정산이 한 트랜잭션. nonce는 `UPDATE … SET nonce = nonce + 1 RETURNING nonce`로 확보, `bets` unique `(seed_pair_id, nonce)`.
- 게임 변환 함수는 **SQL과 TS 양쪽**에 구현(TS = 검증 페이지·테스트용). 불일치를 막기 위해 **정수 연산으로 규정**:
  - 해시 → 난수: 4바이트씩 `uint32` 정수로 사용 (float 변환 없음).
  - 배율: 100배 정수(`bigint`, 예: 2.50x = 250).
  - 배율표: 상수 배열로 하드코딩.
- 일치 테스트: 시드 1,000개 × 게임별 fuzz로 SQL(로컬 Supabase) 결과와 TS 결과를 비교.
- **시드 교체:** 해당 유저에게 `active` 세션(Mines·Chicken·HiLo)이 있으면 거부. 세션은 시작 시 `seed_pair_id`에 고정.
- **Crash:** 해시 체인 10,000개를 사전 생성(`private.crash_chain`), 마지막 해시(terminal hash)를 `/fair` 페이지에 선공개. 라운드 종료 시 해당 seed 공개.
- **한계 명시:** 운영자(service role 보유자)는 시드를 미리 볼 수 있다. provably fair는 "사후 조작 불가"만 증명. `/fair` 페이지에 문구로 고지하고, 관리자 계정의 게임 기록은 랭킹에 표시만 하고 별도 표식.

---

## 결정 5. Crash 실시간 구조

| 옵션 | 장점 | 단점 |
|---|---|---|
| **A. 시간 기반 라운드 + 상태 폴링 RPC** | 상주 프로세스 불필요 | 폴링 부하(10명이면 무시 가능) |
| B. 상주 워커(Fly.io) + broadcast | 전통적 | 배포 대상 2개 |
| C. 클라이언트 방장이 루프 | 서버 불필요 | 조작 가능, 이탈 시 멈춤 |

**추천: A.**
- 공식:
  - `crash_point = min(1_000_000, max(1.00, floor(99 / (1 - U)) / 100))` — U = seed 해시 상위 52bit / 2^52. RTP 99%. (이 공식만 52bit 정수 연산으로 SQL·TS 동일 구현)
  - 배율 `m(t) = floor(100 · e^(0.00015 · ms)) / 100` (2×≈4.6초, 10×≈15초 — `crash-demo.html`과 동일).
- 테이블:
  - 공개 `crash_rounds(id, hash, betting_ends_at, status, crash_point_revealed, seed_revealed)` — 비밀값 없음.
  - 비공개 `private.crash_round_secrets(round_id, seed, crash_point, crashed_at)`.
  - 공개 `crash_bets(round_id, user_id, stake, auto_cashout, cashed_out_at_multiplier, payout)`.
- **단 하나의 상태 RPC** `public.crash_state()` (authenticated 호출 가능, SECURITY DEFINER, 비밀값은 조건부로만 반환):
  1. `pg_advisory_xact_lock`
  2. 현재 라운드가 `now() >= crashed_at`이면 → 정산(자동 캐시아웃 일괄 지급, `WHERE payout IS NULL` 멱등) → `status='crashed'`, crash_point·seed 공개.
  3. crashed 후 3초가 지났으면 다음 라운드 생성: **`betting_ends_at = now() + 5s`** (생성 시점 기준, 오래 비어 있어도 베팅 창 보장).
  4. 반환: `{ round_id, phase, betting_ends_at, db_now, crash_point_if_crashed, bets_version, bets[] }`. `bets[]`는 클라이언트가 보낸 `bets_version`과 다를 때만 포함.
- `VOLATILE`, 항상 POST 호출 (read-only 트랜잭션이면 정산 쓰기가 실패하므로).
- 클라이언트 폴링: Crash 페이지가 보일 때만(`visibilitychange`), 상승 구간 250ms, 베팅 구간·종료 구간 1초. 응답이 500ms 넘게 늦으면 애니메이션을 현재 값에서 멈춤(지나쳤다가 되돌아가는 현상 방지).
- 베팅 `public.crash_bet(stake, auto_cashout)` / 캐시아웃 `public.crash_cashout()` 래퍼. **두 함수 모두 `crash_state`와 같은 advisory lock** 사용.
- `crashed_at` = `m(ms) >= crash_point`가 되는 **최소 ms** (같은 SQL `m()` 함수로 계산, `ln()` 역산 금지 → 경계 1ms 오차 제거).
- 캐시아웃 판정 (라운드 `status='running'`일 때만):
  - `m_now = m(now() - betting_ends_at)`
  - `m_now >= crash_point`이면 거부 (이미 터짐).
  - `auto_cashout`이 있고 `m_now >= auto_cashout`이면 → `auto_cashout` 배율로 지급 (자동 설정보다 더 받는 것 불가).
  - 그 외 → `m_now`로 지급. `UPDATE crash_bets … WHERE payout IS NULL`로 1회만.
- 다른 사람 베팅·캐시아웃 표시는 `crash_state()` 반환값의 `bets[]`로 처리 (broadcast 위조 문제 회피, Realtime 불필요).
- UX 고지: "캐시아웃은 서버 도착 시각 기준" 툴팁.

**리스크:**
- 요청 수(최대 40 req/s)보다 **무료 egress 5GB/월**이 먼저 걸림. 대응: 페이지 가시성 폴링 + `bets_version` 차분 + 비상승 구간 1초 → 평상시 응답 ~200B로 월 100시간 이상 플레이 가능 목표.
- 단계 5 완료 기준에 응답 크기·egress 측정 포함 (**응답 헤더 포함 실측**).

---

## 결정 6. 게임 로직 위치와 세션

| 옵션 | 장점 | 단점 |
|---|---|---|
| **A. 게임 1동작 = public 래퍼 RPC 1개 → private 로직 (RNG·상태 전이·원장 모두 SQL)** | 원자성 완전 보장, Vercel 경유 없음 | SQL 코드량 증가 |
| B. 수학은 TS, 돈만 RPC | 테스트 쉬움 | nonce·상태 전이·지급이 여러 호출로 쪼개져 경합 |

**추천: A** (1차 평가의 치명 이슈 5·6 해결).
- 단판: `public.play_dice / play_limbo / play_wheel / play_plinko(stake, params)` → 결과 + 새 잔액 반환.
- 세션형: `public.session_start(game, stake, params)` / `session_step(session_id, action)` / `session_cashout(session_id)`. 세션 소유자 = `auth.uid()` 검사.
  - 지뢰 배치·덱은 `private.session_secrets`에만.
  - 상태 전이는 `UPDATE … WHERE status='active' RETURNING`, 0행이면 예외.
  - 부분 unique index: 유저·게임당 `active` 1개.
- Plinko: RPC가 좌/우 경로 배열 반환 → 클라이언트는 경로대로 애니메이션만.
- 입력 검증: stake ≥ 1, ≤ 잔액; 게임별 파라미터 범위(Mines 1~24, Dice 목표 2~98 등)는 SQL에서도 재검증.

---

## 결정 7. 친구 예측 베팅

| 옵션 | 장점 | 단점 |
|---|---|---|
| **A. 패리뮤추얼** | 하우스 리스크 0, 소수파 대박 | 배당 변동 |
| B. 고정 배당 | 직관적 | 인플레 위험 |

**추천: A.**
- 누구나 생성, 선택지 2~6개, 마감 시각 필수(마감 판정은 DB `now()`).
- 확정은 관리자만: `public.settle_prediction(market, winning_option)` (래퍼 내부에서 admin 검사).
  - 배당 = `floor(내 베팅 × 총풀 / 정답풀)`. 반올림 자투리는 소멸.
  - 정답풀 = 0 → 전액 환불. 무효 처리 → 전액 환불.
  - `market.status` 조건부 전이로 1회만 정산.

---

## 결정 8. 경제 밸런스

| 옵션 | 장점 | 단점 |
|---|---|---|
| **A. RTP 99% + 출석·구제금 공급** | 랭킹 의미 유지 | 튜닝 필요 |
| B. RTP 100% | 공정 | 인플레 |

**추천: A.** 초기값: 가입 10,000P, 출석 500P, 구제금(잔액 <100P) 1일 1회 1,000P. 수치는 `private.settings`. 관리 UI는 후순위(SQL로 수정).

---

## 결정 9. 프론트 / 연출

| 옵션 | 장점 | 단점 |
|---|---|---|
| **A. Tailwind + shadcn/ui, Framer Motion, Canvas 2D(Crash·Plinko), Howler.js** | 가볍고 모바일 충분 | Canvas 직접 구현 |
| B. PixiJS/Phaser | 화려함 | 번들 큼, UI 이질적 |

**추천: A.** 공통 연출: 카운트업, 큰 배율 당첨 시 흔들림·폭죽, near-miss 강조, 효과음 토글.
실시간 피드: `feed_events` 테이블(서버 RPC만 insert, 10배 이상 당첨·예측 확정) → Realtime postgres_changes 구독 (insert 권한 없으므로 위조 불가).

---

## 구현 단계 (각 단계 후 평가 → 통과 시 다음)

| 단계 | 내용 | 완료 기준 |
|---|---|---|
| 1 | Next.js·Supabase CLI·마이그레이션·타입 생성·Vitest 셋업, profiles·ledger·settings, 초대 가입/로그인, 지갑, 권한(REVOKE) 검증 | 가입 → 10,000P; anon/authenticated로 private 접근·`auth.signUp` 직접 가입 실패; 동시 요청 테스트로 음수 잔액·보너스 중복 불가 |
| 2 | 시드 쌍 + RNG(SQL·TS) + `/fair` 검증 페이지 + Dice·Limbo·Wheel | SQL↔TS 결과 일치 테스트, 3게임 정산 |
| 3 | Plinko | 경로 애니메이션, 8~16줄 × 3리스크 배율표, RTP 시뮬레이션 ≈99% |
| 4 | Mines·Chicken Road·HiLo | 동시 cashout 2회 → 1회만 성공; active 중 시드 교체 거부 |
| 5 | Crash | 브라우저 2개 같은 라운드, 상호 캐시아웃 표시, auto 초과 수동 캐시아웃 차단, 응답 크기·egress 측정 |
| 6 | 예측 베팅 + 관리자 화면(확정·비번 리셋·초대코드 교체) | 생성→베팅→확정→배당, 정답풀 0 환불, 무효 환불 |
| 7 | 피드·랭킹·출석·구제금 (미션·칭호는 최소: 칭호 5개 고정 조건) | 랭킹 = 원장 합계와 일치 |
| 8 | 연출·효과음·모바일 폴리시, Vercel 배포 | 모바일 실기기 스모크 |

---

## Open questions
1. **예측 베팅 이해충돌:** 주제 생성자·관리자도 베팅 가능? (추천: 가능. 관리자가 베팅한 주제는 다른 유저 1명의 확인이 있어야 확정)
2. **랭킹 기준:** 현재 잔액 / 주간 순수익 / 최고 배율? (추천: 주간 순수익 메인 + 최고 배율 보조)
3. **도메인:** `*.vercel.app` 기본 도메인으로 충분?
4. **계정:** Supabase·Vercel 계정을 직접 만들어 키를 넣어줄 수 있나요? (1단계 로컬 개발은 계정 없이 가능, 배포 시 필요)
