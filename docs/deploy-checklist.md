# 배포 체크리스트 (Vercel + Supabase)

배포는 마지막 단계. 아래 항목을 **모두** 끝내기 전에는 링크를 친구들에게 공유하지 않는다.

## 필수 (평가 조건)
- [ ] 배포 직후 초대코드 교체 — 마이그레이션에 평문 `'totoro'`가 들어 있음
  ```sql
  update private.settings set value = '"새-초대코드"' where key = 'invite_code';
  ```
- [ ] `/api/signup`에 IP 기준 rate limit (admin `createUser`는 GoTrue rate limit을 받지 않음 → 초대코드만 알면 계정·보너스 대량 생성 가능)
- [ ] `engine_rw` 비밀번호 설정 (저장소에 없음)
  ```sql
  alter role engine_rw password '<긴 무작위 값>';
  ```

## 환경변수 (Vercel 대시보드에만, `.env*`는 커밋 금지 — 저장소가 public)
| 이름 | 값 |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | 프로젝트 URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | anon(publishable) 키 |
| `SUPABASE_SERVICE_ROLE_KEY` | service role 키 |
| `ENGINE_DATABASE_URL` | Supavisor **트랜잭션 모드(6543)** 주소, 사용자 `engine_rw` |

## Supabase 설정
- [ ] Auth → "Allow new user signups" 끄기 (로컬 `config.toml`의 `enable_signup = false`와 동일)
- [ ] `pg_cron` 확장 켜기 (마이그레이션이 `close-abandoned-rooms` 작업을 등록)
- [ ] Vercel 함수 리전 = Supabase 리전
- [ ] 무료 프로젝트 7일 비활성 일시정지 대비 (Vercel Cron 일 1회 ping)

## 새 마이그레이션을 쓸 때
- public/private에 함수를 새로 만들면 **함수마다** `revoke execute ... from public, anon, authenticated`를 명시 (스키마 기본값으로는 PUBLIC EXECUTE가 안 빠짐). `tests/core.test.ts`의 카탈로그 검사가 잡아 준다.
