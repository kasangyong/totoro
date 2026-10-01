// 혼자 하는 게임 서비스. 사용자 시드 행을 잠그고 → nonce를 하나 쓰고 → 판정 → 원장(solo_bet/solo_payout) → 기록, 전부 트랜잭션 1개.
import { randomBytes } from "node:crypto";
import { commitOf, isValidClientSeed, RNG_VERSION, type Rng } from "../engine/rng";
import {
  CHICKEN,
  MAX_BET,
  MIN_BET,
  chickenDeathLane,
  chickenMult100,
  fractionMult100,
  hiloCards,
  hiloHit,
  hiloOdds,
  hiloStep,
  minesBoard,
  minesMult100,
  payoutOf,
  playDice,
  playLimbo,
  playPlinko,
  playWheel,
  soloRng,
  HILO_MAX_CARDS,
  type ChickenDifficulty,
  type Fraction,
  type HiloCard,
  type HiloGuess,
} from "../engine/solo/games";
import { engineDb, type Tx } from "../rooms/db";
import { RoomError as GameError } from "../rooms/service";

export { GameError };

export const INSTANT_GAMES = ["dice", "limbo", "wheel", "plinko"] as const;
export const SESSION_GAMES = ["mines", "chicken", "hilo"] as const;
export type InstantGame = (typeof INSTANT_GAMES)[number];
export type SessionGame = (typeof SESSION_GAMES)[number];

type SeedRow = { user_id: string; seed_pair_id: string; server_seed: string; client_seed: string; nonce: number };
type Ctx = { tx: Tx; userId: string; seed: SeedRow };

function pgCode(e: unknown): string | undefined {
  return typeof e === "object" && e !== null && "code" in e ? String((e as { code: unknown }).code) : undefined;
}

async function newSeedPair(tx: Tx, userId: string, clientSeed = randomBytes(16).toString("hex")) {
  const serverSeed = randomBytes(32).toString("hex");
  const [pair] = await tx<{ id: string }[]>`
    insert into public.seed_pairs (user_id, commit_hash, client_seed)
    values (${userId}, ${commitOf(serverSeed)}, ${clientSeed}) returning id`;
  return { pairId: pair.id, serverSeed, clientSeed };
}

/** 사용자별로 직렬화: 시드 행을 잠근다 (없으면 만든다). 잠금 순서: user_seeds → profiles(원장 함수 안) */
async function withUser<T>(userId: string, fn: (ctx: Ctx) => Promise<T>): Promise<T> {
  const sql = engineDb();
  try {
    return (await sql.begin(async (tx) => {
      // 같은 사용자의 요청을 먼저 줄 세운다 (첫 시드 생성 경합과 원장 잠금이 엇갈려 생기는 데드락 방지)
      await tx`select pg_advisory_xact_lock(hashtext(${"solo:" + userId}))`;
      let [seed] = await tx<SeedRow[]>`select * from private.user_seeds where user_id = ${userId} for update`;
      if (!seed) {
        const p = await newSeedPair(tx, userId);
        await tx`insert into private.user_seeds (user_id, seed_pair_id, server_seed, client_seed)
                 values (${userId}, ${p.pairId}, ${p.serverSeed}, ${p.clientSeed}) on conflict (user_id) do nothing`;
        [seed] = await tx<SeedRow[]>`select * from private.user_seeds where user_id = ${userId} for update`;
      }
      return fn({ tx, userId, seed });
    })) as T;
  } catch (e) {
    if (e instanceof GameError) throw e;
    const code = pgCode(e);
    if (code === "P0001") throw new GameError("포인트가 모자라요.", 400);
    if (code === "23505") throw new GameError("이미 진행 중인 판이 있어요.", 409);
    if (code === "22P02") throw new GameError("잘못된 요청이에요.", 400);
    throw e;
  }
}

async function takeNonce(ctx: Ctx): Promise<{ rng: Rng; nonce: number }> {
  const nonce = ctx.seed.nonce;
  await ctx.tx`update private.user_seeds set nonce = nonce + 1 where user_id = ${ctx.userId}`;
  ctx.seed.nonce += 1;
  return { nonce, rng: soloRng({ serverSeed: ctx.seed.server_seed, clientSeed: ctx.seed.client_seed, userId: ctx.userId, nonce }) };
}

function checkBet(bet: number) {
  if (!Number.isSafeInteger(bet) || bet < MIN_BET) throw new GameError(`${MIN_BET}P 이상부터 걸 수 있어요.`);
  if (bet > MAX_BET) throw new GameError(`한 판에 최대 ${MAX_BET.toLocaleString("ko-KR")}P까지 걸 수 있어요.`);
}

async function balanceOf(tx: Tx, userId: string): Promise<number> {
  const [r] = await tx<{ balance: number }[]>`select balance from public.profiles where id = ${userId}`;
  return r.balance;
}

// ── 공정성: 시드 보기 · 바꾸기 ─────────────────────────────

export async function getFairness(userId: string) {
  return withUser(userId, async (ctx) => {
    const pairs = await ctx.tx<{ id: string; commit_hash: string; client_seed: string; server_seed: string | null; created_at: Date }[]>`
      select id, commit_hash, client_seed, server_seed, created_at from public.seed_pairs
      where user_id = ${userId} order by created_at desc limit 10`;
    return {
      rngVersion: RNG_VERSION,
      current: { seedPairId: ctx.seed.seed_pair_id, commit: commitOf(ctx.seed.server_seed), clientSeed: ctx.seed.client_seed, nonce: ctx.seed.nonce },
      revealed: pairs.filter((p) => p.server_seed !== null),
    };
  });
}

/** 지금 서버 시드를 공개하고 새 시드 쌍으로 바꾼다. 진행 중인 세션이 있으면 거부 (공개하면 남은 칸이 드러나므로). */
export async function rotateSeed(userId: string, clientSeed?: string) {
  if (clientSeed !== undefined && !isValidClientSeed(clientSeed)) {
    throw new GameError("클라이언트 시드는 소문자 16진수 32자예요.");
  }
  return withUser(userId, async (ctx) => {
    const [active] = await ctx.tx`select 1 from public.solo_bets where user_id = ${userId} and status = 'active' limit 1`;
    if (active) throw new GameError("진행 중인 판을 끝낸 뒤에 바꿀 수 있어요.", 409);
    await ctx.tx`update public.seed_pairs set server_seed = ${ctx.seed.server_seed}, revealed_at = now()
                 where id = ${ctx.seed.seed_pair_id}`;
    const p = await newSeedPair(ctx.tx, userId, clientSeed);
    await ctx.tx`update private.user_seeds
                 set seed_pair_id = ${p.pairId}, server_seed = ${p.serverSeed}, client_seed = ${p.clientSeed}, nonce = 0
                 where user_id = ${userId}`;
    return { revealedServerSeed: ctx.seed.server_seed, commit: commitOf(p.serverSeed), clientSeed: p.clientSeed };
  });
}

// ── 단판 게임 ───────────────────────────────────────────

export async function playInstant(userId: string, game: InstantGame, bet: number, params: Record<string, unknown>) {
  checkBet(bet);
  return withUser(userId, async (ctx) => {
    const { rng, nonce } = await takeNonce(ctx);
    let result: { win: boolean; payout: number; mult100: number } & Record<string, unknown>;
    let clean: Record<string, unknown>;
    try {
      switch (game) {
        case "dice":
          clean = { mode: params.mode, target: params.target };
          result = playDice(rng, bet, clean as never);
          break;
        case "limbo":
          clean = { target100: params.target100 };
          result = playLimbo(rng, bet, clean as never);
          break;
        case "wheel":
          clean = { risk: params.risk, segments: params.segments };
          result = playWheel(rng, bet, clean as never);
          break;
        case "plinko":
          clean = { rows: params.rows, risk: params.risk };
          result = playPlinko(rng, bet, clean as never);
          break;
      }
    } catch {
      throw new GameError("설정 값이 맞지 않아요.");
    }
    const [row] = await ctx.tx<{ id: string }[]>`
      insert into public.solo_bets (user_id, game, seed_pair_id, nonce, stake, payout, params, state, status, ended_at)
      values (${userId}, ${game}, ${ctx.seed.seed_pair_id}, ${nonce}, ${bet}, ${result.payout},
              ${ctx.tx.json(clean as never)}, ${ctx.tx.json(result as never)}, ${result.payout > 0 ? "won" : "lost"}, now())
      returning id`;
    await ctx.tx`select private.solo_bet(${userId}, ${"solo:" + row.id}, ${bet})`;
    await ctx.tx`select private.solo_payout(${userId}, ${"solo:" + row.id}, ${result.payout})`;
    return { betId: row.id, nonce, result, balance: await balanceOf(ctx.tx, userId) };
  });
}

// ── 세션형 게임 (Mines · Chicken · HiLo) ──────────────────

type MinesState = { mines: number; revealed: number[]; mult100: number; next100: number; board?: number[] };
type ChickenState = { difficulty: ChickenDifficulty; lanes: number; crossed: number; mult100: number; next100: number; deathLane?: number };
type HiloState = {
  current: HiloCard;
  index: number;
  correct: number;
  acc: Fraction;
  mult100: number;
  history: { card: HiloCard; guess: HiloGuess | "skip"; hit: boolean | null }[];
};
type SessionRow = { id: string; game: SessionGame; stake: number; state: MinesState & ChickenState & HiloState; params: Record<string, unknown> };

async function activeSession(ctx: Ctx, game: SessionGame): Promise<SessionRow | undefined> {
  const [row] = await ctx.tx<SessionRow[]>`
    select id, game, stake, state, params from public.solo_bets
    where user_id = ${ctx.userId} and game = ${game} and status = 'active' for update`;
  return row;
}

async function secretOf<T>(ctx: Ctx, betId: string): Promise<T> {
  const [r] = await ctx.tx<{ secret: T }[]>`select secret from private.solo_secrets where bet_id = ${betId}`;
  return r.secret;
}

async function finish(ctx: Ctx, row: SessionRow, state: object, payout: number) {
  await ctx.tx`update public.solo_bets
               set state = ${ctx.tx.json(state as never)}, payout = ${payout}, status = ${payout > 0 ? "won" : "lost"}, ended_at = now()
               where id = ${row.id}`;
  await ctx.tx`select private.solo_payout(${ctx.userId}, ${"solo:" + row.id}, ${payout})`;
}

export async function getSession(userId: string, game: SessionGame) {
  return withUser(userId, async (ctx) => {
    const row = await activeSession(ctx, game);
    return { session: row ? { betId: row.id, stake: row.stake, state: row.state } : null, balance: await balanceOf(ctx.tx, userId) };
  });
}

export async function startSession(userId: string, game: SessionGame, bet: number, params: Record<string, unknown>) {
  checkBet(bet);
  return withUser(userId, async (ctx) => {
    if (await activeSession(ctx, game)) throw new GameError("이미 진행 중인 판이 있어요.", 409);
    const { rng, nonce } = await takeNonce(ctx);
    let state: object;
    let secret: object;
    let clean: Record<string, unknown>;
    if (game === "mines") {
      const mines = Number(params.mines);
      if (!Number.isInteger(mines) || mines < 1 || mines > 24) throw new GameError("지뢰는 1~24개예요.");
      clean = { mines };
      secret = { board: minesBoard(rng, mines) };
      state = { mines, revealed: [], mult100: 100, next100: minesMult100(mines, 1) } satisfies MinesState;
    } else if (game === "chicken") {
      const difficulty = params.difficulty as ChickenDifficulty;
      if (typeof difficulty !== "string" || !Object.hasOwn(CHICKEN, difficulty)) throw new GameError("난이도가 맞지 않아요.");
      clean = { difficulty };
      const deathLane = chickenDeathLane(rng, difficulty);
      secret = { deathLane };
      state = {
        difficulty,
        lanes: CHICKEN[difficulty].lanes,
        crossed: 0,
        mult100: 100,
        next100: chickenMult100(difficulty, 1),
      } satisfies ChickenState;
    } else {
      clean = {};
      const cards = hiloCards(rng);
      secret = { cards };
      state = { current: cards[0], index: 0, correct: 0, acc: { num: "1", den: "1" }, mult100: 100, history: [] } satisfies HiloState;
    }
    const [row] = await ctx.tx<SessionRow[]>`
      insert into public.solo_bets (user_id, game, seed_pair_id, nonce, stake, params, state, status)
      values (${userId}, ${game}, ${ctx.seed.seed_pair_id}, ${nonce}, ${bet}, ${ctx.tx.json(clean as never)},
              ${ctx.tx.json(state as never)}, 'active')
      returning id, game, stake, state, params`;
    await ctx.tx`insert into private.solo_secrets (bet_id, secret) values (${row.id}, ${ctx.tx.json(secret as never)})`;
    await ctx.tx`select private.solo_bet(${userId}, ${"solo:" + row.id}, ${bet})`;
    // 치킨은 출발하면 바로 첫 칸을 건넌다
    if (game === "chicken") return chickenAdvance(ctx, row);
    return { betId: row.id, nonce, state: row.state, status: "active" as const, payout: null, balance: await balanceOf(ctx.tx, userId) };
  });
}

async function chickenAdvance(ctx: Ctx, row: SessionRow) {
  const s = row.state as ChickenState;
  const { deathLane } = await secretOf<{ deathLane: number }>(ctx, row.id);
  const lane = s.crossed + 1;
  if (lane === deathLane) {
    const state = { ...s, deathLane };
    await finish(ctx, row, state, 0);
    return { betId: row.id, state, status: "lost" as const, payout: 0, balance: await balanceOf(ctx.tx, ctx.userId) };
  }
  const state: ChickenState = { ...s, crossed: lane, mult100: chickenMult100(s.difficulty, lane), next100: chickenMult100(s.difficulty, lane + 1) };
  if (lane === s.lanes) return cashoutRow(ctx, { ...row, state: state as SessionRow["state"] }, { ...state, deathLane });
  await ctx.tx`update public.solo_bets set state = ${ctx.tx.json(state as never)} where id = ${row.id}`;
  return { betId: row.id, state, status: "active" as const, payout: null, balance: await balanceOf(ctx.tx, ctx.userId) };
}

async function cashoutRow(ctx: Ctx, row: SessionRow, finalState: object) {
  const payout = payoutOf(row.stake, row.state.mult100);
  await finish(ctx, row, finalState, payout);
  return { betId: row.id, state: finalState, status: "won" as const, payout, balance: await balanceOf(ctx.tx, ctx.userId) };
}

export async function stepSession(userId: string, game: SessionGame, action: Record<string, unknown>) {
  return withUser(userId, async (ctx) => {
    const row = await activeSession(ctx, game);
    if (!row) throw new GameError("진행 중인 판이 없어요.", 409);

    if (game === "mines") {
      const tile = Number(action.tile);
      const s = row.state as MinesState;
      if (!Number.isInteger(tile) || tile < 0 || tile > 24 || s.revealed.includes(tile)) throw new GameError("그 칸은 열 수 없어요.");
      const { board } = await secretOf<{ board: number[] }>(ctx, row.id);
      if (board.includes(tile)) {
        const state = { ...s, revealed: [...s.revealed, tile], board };
        await finish(ctx, row, state, 0);
        return { betId: row.id, state, status: "lost" as const, payout: 0, balance: await balanceOf(ctx.tx, userId) };
      }
      const found = s.revealed.length + 1;
      const allFound = found === 25 - s.mines;
      // 마지막 보석이면 다음 칸이 없다 (next100 계산 시 0으로 나누기)
      const state: MinesState = { ...s, revealed: [...s.revealed, tile], mult100: minesMult100(s.mines, found), next100: allFound ? 0 : minesMult100(s.mines, found + 1) };
      if (allFound) return cashoutRow(ctx, { ...row, state: state as SessionRow["state"] }, { ...state, board });
      await ctx.tx`update public.solo_bets set state = ${ctx.tx.json(state as never)} where id = ${row.id}`;
      return { betId: row.id, state, status: "active" as const, payout: null, balance: await balanceOf(ctx.tx, userId) };
    }

    if (game === "chicken") return chickenAdvance(ctx, row);

    // HiLo
    const s = row.state as HiloState;
    const { cards } = await secretOf<{ cards: HiloCard[] }>(ctx, row.id);
    if (s.index + 1 >= HILO_MAX_CARDS) {
      // [우리 규칙] 카드를 다 쓰면 판을 끝낸다: 맞힌 게 있으면 그 배율로 지급, 없으면 베팅액 그대로 돌려줌
      if (s.correct > 0) return cashoutRow(ctx, row, s);
      await finish(ctx, row, s, row.stake);
      return { betId: row.id, state: s, status: "won" as const, payout: row.stake, balance: await balanceOf(ctx.tx, userId) };
    }
    const next = cards[s.index + 1];
    if (action.guess === "skip") {
      const state: HiloState = { ...s, current: next, index: s.index + 1, history: [...s.history, { card: s.current, guess: "skip", hit: null }] };
      await ctx.tx`update public.solo_bets set state = ${ctx.tx.json(state as never)} where id = ${row.id}`;
      return { betId: row.id, state, status: "active" as const, payout: null, balance: await balanceOf(ctx.tx, userId) };
    }
    const guess = action.guess as HiloGuess;
    const odds = hiloOdds(s.current.rank, guess);
    if (odds === null) throw new GameError("고를 수 없는 선택이에요.");
    const hit = hiloHit(s.current.rank, guess, next.rank);
    const history = [...s.history, { card: s.current, guess, hit }];
    if (!hit) {
      const state = { ...s, current: next, index: s.index + 1, history };
      await finish(ctx, row, state, 0);
      return { betId: row.id, state, status: "lost" as const, payout: 0, balance: await balanceOf(ctx.tx, userId) };
    }
    const acc = hiloStep(s.acc, odds);
    const state: HiloState = { ...s, current: next, index: s.index + 1, correct: s.correct + 1, acc, mult100: fractionMult100(acc), history };
    await ctx.tx`update public.solo_bets set state = ${ctx.tx.json(state as never)} where id = ${row.id}`;
    return { betId: row.id, state, status: "active" as const, payout: null, balance: await balanceOf(ctx.tx, userId) };
  });
}

export async function cashoutSession(userId: string, game: SessionGame) {
  return withUser(userId, async (ctx) => {
    const row = await activeSession(ctx, game);
    if (!row) throw new GameError("진행 중인 판이 없어요.", 409);
    const s = row.state;
    const progressed = game === "mines" ? s.revealed.length > 0 : game === "chicken" ? s.crossed > 0 : s.correct > 0;
    if (!progressed) throw new GameError("한 번 이상 성공해야 받을 수 있어요.", 409);
    const secret = await secretOf<Record<string, unknown>>(ctx, row.id);
    // 끝난 판은 정답도 공개 (지뢰 위치·사고 차선). HiLo 카드 묶음은 남은 장이 많아 공개하지 않고 검증은 시드로 한다.
    const reveal = game === "hilo" ? {} : secret;
    return cashoutRow(ctx, row, { ...s, ...reveal });
  });
}

/** 최근 판 기록 (검증용: 공개된 시드 쌍의 판은 직접 재계산 가능) */
export async function recentBets(userId: string, limit = 20) {
  const sql = engineDb();
  return sql<{ id: string; game: string; nonce: number; seed_pair_id: string; stake: number; payout: number | null; params: unknown; state: unknown; status: string; created_at: Date }[]>`
    select id, game, nonce, seed_pair_id, stake, payout, params, state, status, created_at
    from public.solo_bets where user_id = ${userId} and status <> 'active'
    order by created_at desc limit ${limit}`;
}
