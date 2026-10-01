# 혼자 하는 게임 API (게임 화면 ↔ 서버)

화면은 `app/public/games/*.html` (이연호 데모를 서버에 연결한 것). 같은 도메인이라 로그인 쿠키가 자동으로 붙는다.
결과는 **서버가 정한다** — 화면에서 `crypto.getRandomValues`·`Math.random`으로 결과를 만들지 않는다 (연출용 흔들림·봇 제외, 봇은 없앰).
포인트는 **서버 잔액만** 쓴다 — `localStorage`에 잔액을 저장하지 않는다 (기록·설정 같은 화면용 값은 저장해도 됨).

## 공통
- 응답: 성공 `{ ok: true, data }`, 실패 `{ error: "한국어 메시지" }` + 4xx/5xx. 401이면 `/login`으로 보낸다.
- 금액은 정수 포인트, 최소 베팅 10P. 배율은 **100배 정수** (`mult100: 250` = 2.50×). 지급 = `floor(베팅 × mult100 / 100)`.
- `GET /api/me` → `{ username, balance }`

## 단판: `POST /api/solo/{game}/play` `{ bet, params }`
응답 `data = { betId, nonce, result, balance }` (`balance`는 정산 후 잔액)

| game | params | result |
|---|---|---|
| dice | `{ mode: "under"\|"over", target: 2~98 정수 }` | `{ roll: 0~10000 (100배, 50.00 = 5000), win, mult100, payout }` |
| limbo | `{ target100: 101~100000000 }` | `{ result100, win, mult100, payout }` |
| wheel | `{ risk: "low"\|"med"\|"high", segments: 10\|20\|30 }` | `{ index (칸 번호), win, mult100, payout }` |
| plinko | `{ rows: 8\|12\|16, risk: "low"\|"med"\|"high" }` | `{ path: [0\|1…] (줄마다 0=왼쪽 1=오른쪽), slot, win, mult100, payout }` |

Wheel·Plinko 배율표는 `app/lib/engine/solo/games.ts`의 `WHEEL`·`PLINKO` (HANDOFF §4와 같음). 화면의 표 순서와 같아야 `index`·`slot`이 맞는 칸을 가리킨다.

## 세션형: `POST /api/solo/{mines|chicken|hilo}/{state|start|step|cashout}`
응답 `data = { betId, state, status: "active"|"won"|"lost", payout (끝났을 때), balance }`, `state` 조회는 `{ session: { betId, stake, state } | null, balance }`

| game | start params | step params | state |
|---|---|---|---|
| mines | `{ mines: 1~24 }` | `{ tile: 0~24 }` | `{ mines, revealed: [연 칸], mult100 (지금), next100 (다음 칸 성공 시), board? (끝나면 지뢰 위치) }` — 보석을 다 찾으면 자동 `won` |
| chicken | `{ difficulty: "easy"\|"medium"\|"hard"\|"hell" }` | `{}` (한 칸 앞으로) | `{ difficulty, lanes, crossed, mult100, next100, deathLane? (끝나면 사고 차선) }` — **start가 바로 첫 칸을 건넌다**, 마지막 차선이면 자동 `won` |
| hilo | `{}` | `{ guess: "hi"\|"lo"\|"same"\|"skip" }` | `{ current: { rank 1~13, suit 0~3 }, index, correct, mult100, history: [{ card, guess, hit }] }` — hi = 높거나 같음, lo = 낮거나 같음, A는 hi(더 높음)/same, K는 lo(더 낮음)/same |

- `cashout`은 한 번 이상 성공해야 가능 (`mines` 1칸, `chicken` 1칸, `hilo` 1번 적중).
- 게임마다 진행 중인 판은 1개. 새로고침하면 `state`로 이어서 한다.

## Crash: `POST /api/crash/{state|bet|cashout}`
- `bet` `{ stake, auto100: null | 101~ }`, 베팅은 `bettingEndsAt` 전까지만.
- 응답 `data = { serverNow, round: { id, roundNo, commit, bettingEndsAt, phase: "betting"|"running"|"crashed", crashPoint100, crashedAt, seed }, bets: [{ userId, username, stake, auto100, cashout100, payout }], history: [{ roundNo, crashPoint100 }], balance }`
- 화면 배율: `m(ms) = floor(100 × e^(0.00015 × ms)) / 100`, `ms = (지금 서버 시각) − bettingEndsAt`. 서버 시각 = `serverNow` 기준 오프셋 보정.
- 폴링: 진행 중 250ms, 그 외 1초. 터진 뒤 3초가 지나면 다음 라운드가 열린다.

## 공정성: `GET /api/fair`, `POST /api/fair { clientSeed? }`
지금 시드 쌍(서버 시드는 해시만), 공개된 지난 시드, 최근 판. POST는 지금 서버 시드를 공개하고 교체 (진행 중인 판이 있으면 거부).
