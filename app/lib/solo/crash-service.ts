// Crash 서비스 — 상주 서버 없이 시각 기준으로 진행 (rooms-arch 결정 5와 같은 방식).
// 누가 상태를 조회하든 같은 잠금(advisory lock) 안에서: 터질 시각이 지났으면 정산·공개, 3초 뒤 다음 라운드 생성.
import { randomBytes } from "node:crypto";
import { commitOf } from "../engine/rng";
import { MAX_BET, MIN_BET, payoutOf } from "../engine/solo/games";
import { CRASH_AFTER_MS, CRASH_BETTING_MS, crashMs, crashMultiplier100, crashPointFromSeed } from "../engine/solo/crash";
import { engineDb, type Tx } from "../rooms/db";
import { RoomError as GameError } from "../rooms/service";

type Round = {
  id: string;
  round_no: number;
  commit_hash: string;
  betting_ends_at: Date;
  status: "running" | "crashed";
  crash_point100: number | null;
  crashed_at: Date | null;
  seed: string | null;
};

const LOCK_KEY = 728_100_001; // pg_advisory_xact_lock 키 (Crash 전용)

function pgCode(e: unknown): string | undefined {
  return typeof e === "object" && e !== null && "code" in e ? String((e as { code: unknown }).code) : undefined;
}

async function withCrash<T>(fn: (tx: Tx, now: Date, round: Round) => Promise<T>): Promise<T> {
  const sql = engineDb();
  try {
    return (await sql.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(${LOCK_KEY})`;
      const [{ now }] = await tx<{ now: Date }[]>`select now() as now`;
      const round = await advance(tx, now);
      return fn(tx, now, round);
    })) as T;
  } catch (e) {
    if (e instanceof GameError) throw e;
    const code = pgCode(e);
    if (code === "P0001") throw new GameError("포인트가 모자라요.", 400);
    if (code === "23505") throw new GameError("이번 판에는 이미 걸었어요.", 409);
    throw e;
  }
}

/** 터질 시각이 지났으면 정산하고, 끝난 지 3초가 지났으면 새 라운드를 연다. 현재 라운드를 돌려준다. */
async function advance(tx: Tx, now: Date): Promise<Round> {
  let [round] = await tx<Round[]>`select * from public.crash_rounds order by round_no desc limit 1`;
  if (round?.status === "running") {
    const [secret] = await tx<{ seed: string; crash_point100: number; crash_ms: number }[]>`
      select seed, crash_point100, crash_ms from private.crash_secrets where round_id = ${round.id}`;
    const crashAt = new Date(new Date(round.betting_ends_at).getTime() + secret.crash_ms);
    if (now >= crashAt) {
      // 자동 캐시아웃이 터지는 배율 이하면 그 배율로 지급, 나머지는 잃음
      const bets = await tx<{ user_id: string; stake: number; auto100: number | null }[]>`
        select user_id, stake, auto100 from public.crash_bets where round_id = ${round.id} and payout is null order by user_id`;
      for (const b of bets) {
        const hit = b.auto100 !== null && b.auto100 <= secret.crash_point100;
        const payout = hit ? payoutOf(b.stake, b.auto100!) : 0;
        await tx`update public.crash_bets set cashout100 = ${hit ? b.auto100 : null}, payout = ${payout}
                 where round_id = ${round.id} and user_id = ${b.user_id}`;
        if (payout > 0) await tx`select private.solo_payout(${b.user_id}, ${`crash:${round.id}`}, ${payout})`;
      }
      [round] = await tx<Round[]>`
        update public.crash_rounds set status = 'crashed', crash_point100 = ${secret.crash_point100},
               crashed_at = ${crashAt}, seed = ${secret.seed}
        where id = ${round.id} returning *`;
    }
  }
  const needNew = !round || (round.status === "crashed" && now.getTime() >= new Date(round.crashed_at!).getTime() + CRASH_AFTER_MS);
  if (needNew) {
    const seed = randomBytes(32).toString("hex");
    const point = crashPointFromSeed(seed);
    [round] = await tx<Round[]>`
      insert into public.crash_rounds (round_no, commit_hash, betting_ends_at, status)
      values (${(round?.round_no ?? 0) + 1}, ${commitOf(seed)}, ${new Date(now.getTime() + CRASH_BETTING_MS)}, 'running')
      returning *`;
    await tx`insert into private.crash_secrets (round_id, seed, crash_point100, crash_ms)
             values (${round.id}, ${seed}, ${point}, ${crashMs(point)})`;
  }
  return round;
}

export type CrashView = {
  serverNow: string;
  round: {
    id: string;
    roundNo: number;
    commit: string;
    bettingEndsAt: string;
    phase: "betting" | "running" | "crashed";
    crashPoint100: number | null;
    crashedAt: string | null;
    seed: string | null;
  };
  bets: { userId: string; username: string; stake: number; auto100: number | null; cashout100: number | null; payout: number | null }[];
  history: { roundNo: number; crashPoint100: number }[];
  balance: number;
};

async function view(tx: Tx, now: Date, round: Round, userId: string): Promise<CrashView> {
  const bets = await tx<{ user_id: string; username: string; stake: number; auto100: number | null; cashout100: number | null; payout: number | null }[]>`
    select b.user_id, p.username, b.stake, b.auto100, b.cashout100, b.payout
    from public.crash_bets b join public.profiles p on p.id = b.user_id
    where b.round_id = ${round.id} order by b.created_at`;
  const history = await tx<{ round_no: number; crash_point100: number }[]>`
    select round_no, crash_point100 from public.crash_rounds where status = 'crashed' order by round_no desc limit 15`;
  const [{ balance }] = await tx<{ balance: number }[]>`select balance from public.profiles where id = ${userId}`;
  const crashed = round.status === "crashed";
  return {
    serverNow: now.toISOString(),
    round: {
      id: round.id,
      roundNo: round.round_no,
      commit: round.commit_hash,
      bettingEndsAt: new Date(round.betting_ends_at).toISOString(),
      phase: crashed ? "crashed" : now < new Date(round.betting_ends_at) ? "betting" : "running",
      crashPoint100: crashed ? round.crash_point100 : null,
      crashedAt: crashed ? new Date(round.crashed_at!).toISOString() : null,
      seed: crashed ? round.seed : null,
    },
    // 다른 사람의 자동 캐시아웃 설정은 터지기 전엔 숨긴다
    bets: bets.map((b) => ({
      userId: b.user_id,
      username: b.username,
      stake: b.stake,
      auto100: crashed || b.user_id === userId ? b.auto100 : null,
      cashout100: b.cashout100,
      payout: b.payout,
    })),
    history: history.map((h) => ({ roundNo: h.round_no, crashPoint100: h.crash_point100 })),
    balance,
  };
}

export function crashState(userId: string) {
  return withCrash((tx, now, round) => view(tx, now, round, userId));
}

export function crashBet(userId: string, stake: number, auto100: number | null) {
  if (!Number.isSafeInteger(stake) || stake < MIN_BET) throw new GameError(`${MIN_BET}P 이상부터 걸 수 있어요.`);
  if (stake > MAX_BET) throw new GameError(`한 판에 최대 ${MAX_BET.toLocaleString("ko-KR")}P까지 걸 수 있어요.`);
  if (auto100 !== null && (!Number.isInteger(auto100) || auto100 < 101 || auto100 > 100_000_000)) {
    throw new GameError("자동 캐시아웃은 1.01× 이상이에요.");
  }
  return withCrash(async (tx, now, round) => {
    if (round.status !== "running" || now >= new Date(round.betting_ends_at)) throw new GameError("베팅 시간이 끝났어요. 다음 판에 걸어 주세요.", 409);
    await tx`insert into public.crash_bets (round_id, user_id, stake, auto100) values (${round.id}, ${userId}, ${stake}, ${auto100})`;
    await tx`select private.solo_bet(${userId}, ${`crash:${round.id}`}, ${stake})`;
    return view(tx, now, round, userId);
  });
}

export function crashCashout(userId: string) {
  return withCrash(async (tx, now, round) => {
    if (round.status !== "running" || now < new Date(round.betting_ends_at)) throw new GameError("지금은 캐시아웃할 수 없어요.", 409);
    const [bet] = await tx<{ stake: number; auto100: number | null; payout: number | null }[]>`
      select stake, auto100, payout from public.crash_bets where round_id = ${round.id} and user_id = ${userId} for update`;
    if (!bet || bet.payout !== null) throw new GameError("캐시아웃할 베팅이 없어요.", 409);
    const m = crashMultiplier100(now.getTime() - new Date(round.betting_ends_at).getTime());
    // advance()가 이미 터졌는지 확인했으므로 여기서 m < 터지는 배율. 자동 설정보다 더 받을 수는 없다.
    const cashout100 = bet.auto100 !== null && m >= bet.auto100 ? bet.auto100 : m;
    const payout = payoutOf(bet.stake, cashout100);
    await tx`update public.crash_bets set cashout100 = ${cashout100}, payout = ${payout}
             where round_id = ${round.id} and user_id = ${userId}`;
    await tx`select private.solo_payout(${userId}, ${`crash:${round.id}`}, ${payout})`;
    return view(tx, now, round, userId);
  });
}
