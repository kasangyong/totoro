# 배팅 할래 말래 — 서버 앱

Next.js 16 + Supabase. 설계는 [`../docs/design/`](../docs/design/), 배포 전 확인은 [`../docs/deploy-checklist.md`](../docs/deploy-checklist.md).

## 로컬 실행
필요: Node 24, Docker Desktop.

```bash
npm install
npx supabase start          # 로컬 Supabase (포트 554xx — 다른 Supabase 프로젝트와 안 겹치게 바꿔 둠)
npm run dev -- --port 3210  # .env 없이 scripts/with-local-env.mjs가 로컬 주소·키를 넣어 줌
```

- 가입 초대코드(로컬): `totoro`
- 개발 모드가 느리면: `npm run build:local && npm run start:local -- --port 3210`

## 테스트
```bash
npm test          # 엔진(순수 로직) 테스트 — DB 필요 없음
npm run test:db   # 로컬 Supabase에 붙는 권한·원장·방 테스트
npm run typecheck && npm run lint
```

## 구조
| 경로 | 내용 |
|---|---|
| `lib/engine/` | 섞기(RNG v1)·한국식 베팅·섯다 규칙. 순수 함수, 서버와 검증 페이지가 같이 씀 |
| `lib/rooms/` | 방 서비스: 트랜잭션 1개로 잠그고 엔진을 돌린 뒤 저장 (`engine_rw` 역할) |
| `supabase/migrations/` | 프로필·원장·방 테이블, 권한 |
| `app/` | 화면 (로비, 로그인, 방 목록, 섯다 테이블, 판 검증) |
