# 배팅 할래 말래 · 인수인계 문서

작성: 2026-09-30 · 저장소: https://github.com/kasangyong/totoro (master)
목적: 다른 컴퓨터에서 이 저장소를 받아 지금까지 만든 것을 그대로 이어 가고, 다음 단계(방·카드 게임)를 구현하기.

---

## 0. 한 줄 요약
친구 최대 10명이 **가상 포인트로만** 즐기는 베팅 게임 사이트. 게임 8개(Crash, Mines, Plinko, 치킨 크로싱, HiLo, Dice, Limbo, Wheel)를 **혼자 하는 브라우저 데모**로 완성했고, 카지노 테이블 디자인의 로비 사이트 "배팅 할래 말래"로 묶었다. 다음은 **방을 만들어 여럿이 하는 카드 게임**(고스톱, 섯다, 포커, 블랙잭)을 **투명하게**(조작 불가·사후 검증 가능) 만드는 것.

## 1. 꼭 지킬 원칙
- **현금 충전·환전 절대 없음.** 친구끼리라도 돈이 오가면 도박죄(형법 246조), 판을 연 사람은 도박개장죄(247조). 포인트는 가상, 현금 가치 없음.
- **모든 게임 기대 환급률(RTP) 99%.** 하우스 엣지 1%. 포인트는 서서히 줄고 출석(500P)·구제금(1,000P)으로 채움.
- **난수는 `crypto.getRandomValues`.** `Math.random`은 연출(봇, 흔들림)에만.
- **실제 서비스에서는 결과를 서버가 정함.** 지금 데모는 브라우저가 정해서 조작 가능 → 데모 한계로 명시해 둠.

## 2. 산출물 위치

### 2-1. 저장소 파일 (https://github.com/kasangyong/totoro)
```bash
git clone https://github.com/kasangyong/totoro
```
| 파일 | 내용 |
|---|---|
| `crash-demo.html` | Crash 단독 데모 (원본) |
| `mines-demo.html` | Mines 단독 데모 (원본) |
| `plinko-demo.html` | Plinko 단독 데모 (원본) |
| `chicken-demo.html` | 치킨 크로싱 단독 데모 (원본) |
| `hilo-demo.html` | HiLo 단독 데모 (원본) |
| `quick-games-demo.html` | Dice·Limbo·Wheel 탭 묶음 (원본) |
| `site/build.js` | 원본 데모 → 사이트 페이지 변환 스크립트 |
| `site/theme.css` | 사이트 공통 테마 (카지노 테이블) |
| `site/index.html` | 로비 |
| `site/crash.html` 등 6개 | build.js가 만든 결과물 (직접 고치지 말 것) |

수정 흐름: `*-demo.html` 고침 → 저장소 맨 위에서 `node site/build.js` → 커밋·푸시 → (아티팩트를 쓰면) 사이트 다시 게시.
- 처음 만든 곳은 `C:\Users\SSAFY\Desktop\lee\game` (이연호 PC)이고, 같은 구조 그대로 저장소에 올림.
- 줄바꿈: 파일은 LF로 작성됨. Windows에서 받으면 git이 CRLF로 바꿀 수 있는데 동작에는 영향 없음.
- ⚠️ `site/index.html`은 아티팩트용이라 `<!doctype html>`·`<head>`가 없음(아티팩트가 게시할 때 자동으로 감쌈). GitHub Pages·Vercel 등에 그대로 올릴 거면 build.js처럼 문서로 감싸고 `<meta charset>`, viewport, `body{margin:0}`, `[hidden]{display:none!important}`를 넣어야 함. 게임 페이지 6개는 build.js가 이미 감싸 둠.

### 2-2. 게시된 아티팩트 (claude.ai, 소유자 계정에서만 열림 — 다른 사람은 공유 필요)
| 이름 | URL |
|---|---|
| **사이트 (로비+전체 게임)** | https://claude.ai/artifact/6wvxWS91k25DNbBzg2cK8p |
| Crash | https://claude.ai/artifact/MRXE5rnt9WtKByQQX7TFvV |
| Mines | https://claude.ai/artifact/K5V8Nxm7dFgUuLGvTCDVSN |
| Plinko | https://claude.ai/artifact/MEiPCoLujps8KcQx1umLvm |
| 치킨 크로싱 | https://claude.ai/artifact/V5JGv891bryojuy6WW7HYi |
| HiLo | https://claude.ai/artifact/NJLLd82Xiyr4UsVUFRr9bd |
| Dice·Limbo·Wheel | https://claude.ai/artifact/MUGahgEBru7mRYHSMDsrh7 |

소스는 저장소(2-1)에 모두 있으므로 아티팩트는 화면 확인용. 아티팩트를 고쳐 다시 게시하려면 소유자 계정에서 Artifact 도구에 `url`을 넘겨 게시(다른 대화에서 `url` 없이 게시하면 새 아티팩트가 생김).

### 2-3. 관련 문서 (kasangyong 님 PC에만 있음, 방에 공유 안 됨)
- `docs/design/betting-site-arch.md` — 실제 서비스 설계 (Next.js + Vercel + Supabase, 평가 3회 통과)
- `docs/product-brief.md` — 요구사항
- 핵심 결정: 초대코드+아이디/비번 가입, 포인트 원장(모든 변동 기록, DB에서 중복 지급 차단), 서버 시드 커밋→공개로 결과 검증, Crash는 시간 기준 계산 + 0.25초 폴링, 예측 베팅은 패리뮤추얼·관리자 확정·정답자 없으면 전액 환불.
- 남은 설계 주의: Supabase는 public 함수에 anon EXECUTE를 자동 부여 → `REVOKE … FROM public, anon, authenticated` 명시. 관리자 비번 리셋은 service role 필요(“Vercel은 가입에만” 문구와 충돌).

## 3. 공통 구현 규칙 (모든 게임 동일)

### 3-1. 저장 (localStorage, 모두 try/catch)
| 키 | 값 |
|---|---|
| `bhmh.bal` | **사이트 공통 지갑** (기본 10,000) |
| `bhmh.daily` | 출석 받은 날짜 `YYYY-M-D` |
| `{game}.stats` | `{rounds, profit, best}` — game = crash, mines, plinko, chicken, hilo, quick |
| `{game}.hist` | 최근 결과 배열 |
| `plinko.cfg` `{rows,risk}` · `chicken.diff` · `quick.cfg` `{dMode,dTarget,lTarget,wRisk,wSeg}` | 설정 기억 |

단독 데모는 게임마다 `{game}.bal` 따로 씀. build.js가 사이트용으로 `bhmh.bal`로 바꿈.

### 3-2. 공통 UI
- 베팅 금액 입력(최소 10P) + ½ / ×2 / 최대 (사이트에선 칩 모양)
- 보유 포인트보다 크게 못 걺. 보유 < 10P면 구제금 1,000P 버튼
- 판 끝나면 `stats` 갱신: rounds+1, profit += (받은 돈 − 베팅), best = 이긴 판 최고 배율
- 스페이스바 = 메인 버튼 (포커스가 버튼일 땐 무시해서 중복 클릭 방지)
- 소리 켜기/끄기 토글. AudioContext는 첫 클릭 때 생성

### 3-3. 효과음·폭죽 라이브러리 (CDN)
```html
<script src="https://cdn.jsdelivr.net/npm/canvas-confetti@1.9.4/dist/confetti.browser.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/jsfxr@1.4.1/riffwave.js"></script>
<script src="https://cdn.jsdelivr.net/npm/jsfxr@1.4.1/sfxr.js"></script>
```
- ⚠️ cdnjs의 canvas-confetti는 CommonJS 빌드라 `confetti`가 전역에 안 생김 → **jsdelivr `dist/confetti.browser.min.js` 사용**.
- jsfxr: `jsfxr.sfxr.generate(preset)` → `jsfxr.sfxr.toWebAudio(params, actx).buffer`를 캐시해서 BufferSource로 재생(playbackRate로 음 높이 조절).
- 프리셋: bet=`blipSelect`, coin=`pickupCoin`, big=`powerUp`, boom=`explosion`, hit=`hitHurt`, tick=`blipSelect`(sustain .02, decay .05).
- 라이브러리 못 불러오면 기존 WebAudio `tone()`으로 대체.
- 폭죽 단계 `burstLevel(m)`: m≥100 → 2(양옆 추가), ≥10 → 1, ≥2 → 0, 그 외 없음. `prefers-reduced-motion`이면 안 함.
- 연속으로 오르는 효과음: rate = `0.8 × 2^(min(n,20)/18)`.

## 4. 게임별 스펙 (이 수식 그대로 구현하면 같은 게임)

### Crash
- 배율 `m(t) = e^(0.00015 × t_ms)` (2×≈4.6초, 10×≈15초)
- 터지는 배율 `max(1, min(1e6, floor(99 / (1 − u)) / 100))`, u∈[0,1) → P(≥x)=0.99/x, 약 1%는 1.00× 즉시
- 흐름: 베팅 5초 → 진행 → 터짐 표시 3초 → 반복. 진행 중 누르면 다음 판 예약
- 자동 캐시아웃(≥1.01): `auto ≤ min(m, crashPoint)`면 auto 배율로 지급
- 캐시아웃 배율은 소수 둘째 자리 내림, 지급 `floor(bet × m)`
- 가상 참가자 봇 3~6명(이름 지훈·서연·도윤·하은·민재·수아·예준·지유, 베팅 100~2000, auto 1.1~10)
- 캔버스 그래프, 끝점 발광, 터지면 빨간색 + 화면 흔들림

### Mines
- 5×5=25칸, 지뢰 k=1~24 (Fisher–Yates + crypto)
- 보석 n개 찾았을 때 배율 `floor(0.99 × Π_{i=0}^{n−1} (25−i)/(25−k−i) × 100) / 100` (n=0이면 1)
- 다음 칸 성공 확률 `(25−k−n)/(25−n)`
- 보석 1개 이상이면 캐시아웃, 전부 찾으면 자동 캐시아웃. 끝나면 남은 지뢰·보석 흐리게 공개
- 배율표(1개~25−k개) 가로 스크롤

### Plinko
- 줄 8/12/16, 위험도 low/med/high. 핀 줄 r(0부터)에 r+3개. 칸 = 줄+1
- 공 경로: 줄마다 crypto 1비트(왼/오), 칸 = 오른쪽 횟수
- 배율표 (왼쪽 끝부터):
  - 8: low `5.6,2.1,1.1,1,0.5,1,1.1,2.1,5.6` · med `13,3,1.3,0.7,0.4,0.7,1.3,3,13` · high `29,4,1.5,0.3,0.2,0.3,1.5,4,29`
  - 12: low `10,3,1.6,1.4,1.1,1,0.5,1,1.1,1.4,1.6,3,10` · med `33,11,4,2,1.1,0.6,0.3,0.6,1.1,2,4,11,33` · high `170,24,8.1,2,0.7,0.2,0.2,0.2,0.7,2,8.1,24,170`
  - 16: low `16,9,2,1.4,1.4,1.2,1.1,1,0.5,1,1.1,1.2,1.4,1.4,2,9,16` · med `110,41,10,5,3,1.5,1,0.5,0.3,0.5,1,1.5,3,5,10,41,110` · high `1000,130,26,9,4,2,0.2,0.2,0.2,0.2,0.2,2,4,9,26,130,1000`
  - 9개 모두 RTP 98.9~99.1% (이항분포로 검증함)
- 한 칸 이동 시간 `1700/(줄+1)` ms, 핀 반짝임, 칸 눌림, 공 여러 개 동시, 자동 10개(230ms 간격). 공이 떨어지는 중엔 설정 잠금

### 치킨 크로싱 (Chicken Road 방식, 상품명이라 이름 바꿈)
| 난이도 | 차선 | 생존 확률 p | 첫 칸 | 끝까지 |
|---|---|---|---|---|
| 쉬움 | 24 | 0.92 | 1.07× | ≈7× |
| 보통 | 22 | 0.84 | 1.17× | ≈46× |
| 어려움 | 20 | 0.76 | 1.30× | ≈240× |
| 지옥 | 15 | 0.60 | 1.65× | ≈2,100× |
- 배율 `floor(0.99 / p^n × 100) / 100`
- 출발 누르면 바로 첫 칸 건넘. '앞으로'마다 crypto로 생존 판정, 마지막 차선이면 자동 캐시아웃. C키 캐시아웃
- 연출: 옆으로 이어진 도로 캔버스, 차선마다 배율 맨홀, 지나온 차선에 차단기, 카메라가 닭 따라감
- **사고 연출 규칙 (버그 수정됨):** 치이는 판이면 그 차선에서 닭에 가장 가까이 내려오던 차가 그대로 달려와 부딪힘(원래 색 유지). 없으면 위에서 새 차 투입. 속도 상한 `h/800 px/ms`, 최소 520ms. 그 뒤 차들은 사고 지점 뒤에서 멈춤(추월 금지). 안전한 판이면 멀리 있는 차는 차단선 앞에 정지, 닭 근처 차는 220ms 동안 흐려지며 사라짐

### HiLo
- A=1(최저) ~ K=13(최고), 매번 13가지 균등(덱 줄지 않음), 무늬 4개 랜덤
- 선택지: 보통 카드 r → '높거나 같음' p=(14−r)/13, '낮거나 같음' p=r/13. A → '높음' 12/13 / '같음' 1/13. K → '낮음' 12/13 / '같음' 1/13
- 선택 배율 `0.99 / p`, 맞히면 누적 곱. 건너뛰기 무료·무제한. 1번 이상 맞혀야 캐시아웃
- 카드 CSS로 그림(뒤집기 애니메이션), 이번 판 카드와 곱해진 배율 줄줄이 표시. 키: ↑ ↓ S Space

### Dice
- 목표 2~98(정수), 모드 '작게'(roll < 목표) / '크게'(roll > 목표)
- roll = `randInt(10001) / 100` (0.00~100.00)
- 이길 확률 = 목표 또는 100−목표 (%), 배율 = `99 / 확률`

### Limbo
- 목표 배율 ≥1.01, 결과는 Crash와 같은 분포 `max(1, min(1e6, floor(99/(1−u))/100))`
- 결과 ≥ 목표면 `bet × 목표` 지급. 이길 확률 = 99/목표 %
- 숫자가 로그 스케일로 0.52초 동안 올라가는 연출

### Wheel
- 칸마다 확률 동일. 표 (전부 RTP 정확히 99%):
  - LOW10 = `1.5,1.2,1.2,1.2,0,1.2,1.2,1.2,1.2,0` → 10칸 low, 20칸 low = LOW10×2, 30칸 low = LOW10×3
  - 10 med `0,1.9,0,1.5,0,2,0,1.5,0,3`
  - 20 med `1.5,0,2,0,2,0,2,0,1.5,0,3,0,1.8,0,2,0,2,0,2,0`
  - 30 med = `1.5,2,1.5,2,1.7,2,2,3.5,2,2,1.5,2,2,2,2` 각 뒤에 0 끼움
  - high n칸 = 마지막 칸만 `0.99×n` (9.9 / 19.8 / 29.7), 나머지 0
- 회전: 목표 칸 중심 + 흔들림(±0.35칸) + 4바퀴, 2.6초 ease-out quart, 칸 지날 때 틱 소리

### Dice·Limbo·Wheel 묶음 페이지 공통
- 탭 3개, 지갑 공유, 주소 `#dice` `#limbo` `#wheel`로 바로 열기, 자동 10번
- **버그 수정됨:** 정산 함수에서 `busy=false`를 `render()`보다 먼저 해야 연속 베팅이 됨

## 5. 사이트 "배팅 할래 말래"

### 5-1. 구조
- `index.html` 로비: 로고 "배팅 ♠ 할래 ♦ 말래", 칩 모양 지갑, 출석 500P(하루 1번)·구제금 1,000P(보유<10P), 게임 카드 9장(3열→2열→1열; PREDICT는 "준비 중"), 내 기록 표(각 `{game}.stats` 합산)
- 게임 카드 링크: `crash.html`, `mines.html`, `plinko.html`, `chicken.html`, `hilo.html`, `quick.html#dice|#limbo|#wheel`
- 카드 최대 배율 표기: Crash 100만×, Mines 500만×(k=12 전부 찾기 ≈ C(25,12)×0.99), Plinko 1,000×, Chicken 2,100×, HiLo 연승 곱, Dice 49.5×, Limbo 100만×, Wheel 29.7×

### 5-2. build.js가 하는 일
1. `<title>` → `게임명 · 배팅 할래 말래`
2. 글꼴 Chakra Petch → **Oswald**(숫자·영문), **Black Han Sans**(로고), IBM Plex Sans KR(본문). 캔버스 폰트 문자열도 교체
3. `'{game}.bal'` → `'bhmh.bal'` (지갑 통합)
4. 머리글 맨 앞에 `<a class="back" href="index.html">‹ 로비</a>`, 부제 → "배팅 할래 말래"
5. `<!doctype html>…<head>` 로 감싸고 `</style>` 뒤에 `<link rel="stylesheet" href="theme.css">`
6. `pageshow`(bfcache 복귀) 시 새로고침 → 다른 게임에서 바뀐 지갑 반영

### 5-3. 디자인 토큰 (theme.css, 모든 페이지가 같은 이름을 씀)
```
--bg:#08221b  --felt:#0e3a2e  --felt-hi:#15523f  --panel:#0d3027  --raise:#164035  --raise-hi:#1d4d40
--line:#2a5747  --fg:#f4eddc(크림)  --muted:#a3b8aa  --accent:#e4b650(금)  --accent-ink:#2b1d04  --gold-dim:#8a6f33
--hot:#ff9446  --blue:#6aa5ff  --win:#74eab0  --win-ink:#05281a  --bust:#ff6b5b  --ball:#ffe7a8
--card:#fbf7ec  --card-ink:#1c2030  --card-red:#c9242f
```
- 배경: 펠트 방사 그라데이션 + SVG 노이즈. 판(stage) 금색 2px 테두리 + 안쪽 그림자. 패널 금색 1px
- 칩 버튼: ½ 파랑 `#2c64c4`, ×2 빨강 `#b8302a`, 최대 검정 `#1b1b1b`, conic 줄무늬 테두리 46px 원
- 메인 버튼 금색 입체(아래 4px 그림자), 캐시아웃 초록 입체
- 치킨 도로(`--asphalt:#1a2135`, `--curb:#3a4462`)는 테마가 덮지 않음
- 캔버스 색은 CSS 변수를 읽어 hex+알파 문자열을 붙이므로 **토큰은 반드시 6자리 hex**

## 6. 알려진 한계
- 결과를 브라우저에서 정함 → 개발자 도구로 조작 가능
- 포인트·기록이 브라우저에만 있음 → 친구끼리 공유 안 됨
- 아티팩트 안에서 페이지 간 링크 이동은 사용자 확인 대기 중
- 로비만 화면 확인, 게임 페이지 6개는 문법 검사만 (미리보기가 theme.css를 못 읽음)
- ASSETMCP는 설치 안 함: 저장소 신뢰도 낮음(emreyvz 포크 9/17 생성 스타 0, 원본 evonar543 스타 3), Python 없음. Kenney 에셋은 kenney.nl에서 직접 받는 방안 보류(Board Game Pack 2.1MB, Playing Cards Pack 190KB, 둘 다 CC0)

## 7. 다음 단계: 방 + 카드 게임 (요청 사항)

### 7-1. 요청 내용 (사용자 원문 요지)
- "다른 사람들이랑 같이 하는 거니까 **방을 만들 수 있게**"
- 게임: **고스톱**, **섯다**(누르면 **2장 / 3장** 선택), **포커**(**텍사스 홀덤** / **"처음에 4장 받고 1장 버리는 것"** 선택), **블랙잭**
  - "4장 받고 1장 버리는 포커" = 한국식 **세븐 포커**로 추정 (4장 받아 1장 버리고 3장 중 1장 공개 후 진행). 구현 전 사용자에게 한 번 확인할 것
- "**투명하게** 만들어야 돼"

### 7-2. "투명하게"의 의미와 설계
두 가지를 동시에 만족해야 함:
1. **아무도 조작 못 함** (방장·개발자 포함)
2. **게임 중엔 남의 패가 안 보임**, 끝난 뒤엔 누구나 섞은 순서를 검증

권장 방식 (서버 있음, provably fair):
- 판 시작 전 서버가 `server_seed`를 만들고 `SHA-256(server_seed)`를 먼저 공개(커밋)
- 참가자마다 `client_seed`를 냄 (참가자도 결과에 기여 → 서버 혼자 못 정함)
- 덱 순서 = `HMAC-SHA256(server_seed, client_seeds 정렬 연결 + ":" + nonce)`로 만든 난수 스트림으로 Fisher–Yates
- 패는 서버가 각자에게만 보냄 (Supabase RLS로 본인 패만 읽기)
- 판 끝나면 `server_seed` 공개 → 누구나 해시 확인 + 덱 재계산 → "검증" 페이지 제공
- 한계: 판 진행 중 서버 운영자는 DB에서 패를 볼 수 있음. 완전 무신뢰가 필요하면 mental poker(SRA 교환암호로 모두가 한 겹씩 암호화·셔플) — 구현 난이도 매우 높음

### 7-3. 플랫폼 결정 (아직 미정 — 사용자에게 확인 필요)
| | 실제 웹 서비스 (권장) | 지금 아티팩트에 붙이기 |
|---|---|---|
| 구성 | kasangyong 설계대로 Next.js + Supabase(Realtime, RLS, RPC) + Vercel | 아티팩트 `room`(실시간 방, `join(name)`으로 방별 채널) + `db`(공유 문서) + `user`(누구인지) |
| 참가 | 링크 + 초대코드 가입 | claude.ai 계정으로 초대받은 사람만 |
| 패 숨기기 | 서버가 본인에게만 전달 | 공유 데이터는 모두 읽을 수 있어서 mental poker 필요 |
| 포인트 조작 방지 | 서버 원장 + DB 제약 | 클라이언트가 쓰기 가능 → 완전 방지 어려움 |
| 필요한 것 | Supabase·Vercel 무료 계정 | 없음 |

### 7-4. 방 기능 최소 요구
- 방 만들기(게임 종류·세부 규칙·최소 베팅·최대 인원) → 방 코드/링크
- 로비에 열린 방 목록, 입장·퇴장, 관전
- 좌석, 준비, 방장 시작, 턴 타이머, 연결 끊김 시 자동 다이/폴드
- 판마다 검증 정보(커밋 해시, 시드, nonce) 기록 → "이 판 검증하기"
- 채팅(선택)

### 7-5. 게임별 규칙 메모 (구현 전 세부 규칙 확정 필요)
- **섯다**: 화투 20장(1~10월 각 2장, 광 1·3·8). 2장: 받자마자 족보 비교. 3장: 3장 받아 2장 선택. 족보: 38광땡 > 18·13광땡 > 장땡~삥땡 > 알리(1·2) > 독사(1·4) > 구삥(9·1) > 장삥(10·1) > 장사(10·4) > 세륙(4·6) > 갑오(9끗) > 끗 > 망통. 특수패(암행어사 4·7, 땡잡이 3·7, 구사 4·9 재경기) 포함 여부 확인. 베팅: 삥·콜·따당·하프·다이 등
- **포커**: 홀덤(개인 2 + 공유 5, 프리플롭·플롭·턴·리버, 블라인드) / 세븐 포커(추정). 족보 판정 공통 모듈
- **고스톱**: 2~3인, 48장, 먹기·뻑·쪽·따닥·싹쓸이·흔들기·폭탄, 3점 이상 고/스톱, 피박·광박·멍박. 규칙이 가장 많아 마지막 권장
- **블랙잭**: 딜러 1(서버) + 플레이어 여럿. 히트·스탠드·더블·스플릿, 딜러 17에서 멈춤, 블랙잭 3:2. 패를 숨길 게 딜러 히든 카드 하나라 투명성 구현이 가장 쉬움 → **첫 멀티 게임으로 권장**

### 7-6. 권장 순서
1. 플랫폼 결정 → (실서비스면) kasangyong 설계 1단계: 셋업·가입·포인트 원장
2. 방 시스템 + provably fair 모듈 + 검증 페이지
3. 블랙잭 → 섯다(2장/3장) → 포커(홀덤/세븐) → 고스톱
4. 기존 8개 게임을 서버 판정으로 옮기기

## 8. 다른 컴퓨터에서 이어받는 법
1. `git clone https://github.com/kasangyong/totoro` → 이 문서(`HANDOFF.md`)부터 읽기
2. 데모는 브라우저로 `*-demo.html`을 바로 열면 동작함. 사이트는 `site/` 폴더를 로컬 서버로 띄워서 확인 (`npx serve site` 등. `file://`로 열면 페이지 간 localStorage가 공유되지 않을 수 있음)
3. 작업 대화 기록은 ccx 방 「게임만들사람」에서 `peer_recent` → `peer_turn_detail`로 볼 수 있음
4. 7-3 플랫폼과 7-1의 "세븐 포커" 해석을 사용자에게 확인하고 시작
