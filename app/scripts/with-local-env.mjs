// 로컬 Supabase(`supabase start`)의 주소·키를 읽어 환경변수로 넣고 명령을 실행한다.
// .env 파일 없이 개발·테스트하기 위한 용도. 배포 환경에서는 쓰지 않는다.
// 사용: node scripts/with-local-env.mjs next dev
import { execSync, spawn } from "node:child_process";

const raw = execSync("npx supabase status -o json", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
const status = JSON.parse(raw.slice(raw.indexOf("{")));

// 엔진 역할(engine_rw) 비밀번호는 저장소에 없다. 로컬 전용 값을 매번 설정한다.
const ENGINE_LOCAL_PASSWORD = "engine-local-dev";
execSync(`docker exec supabase_db_totoro psql -U postgres -c "alter role engine_rw password '${ENGINE_LOCAL_PASSWORD}'"`, {
  stdio: "ignore",
});
const dbUrl = new URL(status.DB_URL);
const engineUrl = new URL(status.DB_URL);
engineUrl.username = "engine_rw";
engineUrl.password = ENGINE_LOCAL_PASSWORD;

const env = {
  ...process.env,
  NEXT_PUBLIC_SUPABASE_URL: status.API_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: status.ANON_KEY,
  SUPABASE_SERVICE_ROLE_KEY: status.SERVICE_ROLE_KEY,
  SUPABASE_DB_URL: dbUrl.toString(),
  ENGINE_DATABASE_URL: engineUrl.toString(),
};

const [cmd, ...args] = process.argv.slice(2);
if (!cmd) {
  console.error("usage: node scripts/with-local-env.mjs <command> [...args]");
  process.exit(1);
}
// Windows에서 next·vitest 같은 .cmd를 찾으려면 셸이 필요하다 → 인자는 직접 따옴표로 감싼다.
const quote = (a) => (/^[\w./:=@-]+$/.test(a) ? a : `"${a.replace(/(["\\])/g, "\\$1")}"`);
const child = spawn([cmd, ...args].map(quote).join(" "), { env, stdio: "inherit", shell: true });
child.on("exit", (code) => process.exit(code ?? 1));
