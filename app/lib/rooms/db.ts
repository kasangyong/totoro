import postgres from "postgres";

// 방 엔진 전용 연결 (engine_rw 역할). Supavisor 트랜잭션 모드에서도 동작하도록 prepared statement를 끈다.
let client: postgres.Sql | null = null;

export function engineDb(): postgres.Sql {
  if (!client) {
    const url = process.env.ENGINE_DATABASE_URL;
    if (!url) throw new Error("ENGINE_DATABASE_URL이 없습니다.");
    client = postgres(url, {
      prepare: false,
      max: 3,
      idle_timeout: 20,
      onnotice: () => {},
      // 포인트(bigint)는 Number 안전 범위 안에서만 쓴다 (방 기본금 상한 10만).
      types: {
        bigint: { to: 20, from: [20], parse: (x: string) => Number(x), serialize: (x: number) => String(x) },
      },
    });
  }
  return client;
}

export type Tx = postgres.TransactionSql;
