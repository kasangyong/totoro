// 방 서비스 — rooms-arch.md 결정 1·4·5·6·7.
// 모든 변경은 트랜잭션 1개: room_state → rooms → room_seats(seat_no 순) 순서로 잠그고, 원장은 table_buyin/cashout 함수로만 움직인다.
import { randomBytes, randomUUID } from "node:crypto";
import type { BetActionType } from "../engine/betting";
import type { BjMove } from "../engine/blackjack/game";
import { MAX_BET } from "../engine/solo/games";
import { autoClientSeed, commitOf, isValidClientSeed, RNG_VERSION } from "../engine/rng";
import type { PokerCard } from "../engine/poker7/hands";
import { engineDb, type Tx } from "./db";
import {
  createGame,
  GAME_KINDS,
  isDone,
  legalFor,
  minPlayers,
  reduceGame,
  summarize,
  timedOutBy,
  timeoutAction,
  viewGame,
  waitKind,
  type GameAction,
  type GameKind,
  type GameState,
  type GameView,
  type LegalAction,
} from "./games";

export const SEED_MS = 5_000;
export const TURN_MS = 20_000;
export const REJOIN_MS = 10_000;
export const CHOICE_MS = 15_000;
export const BET_MS = 15_000;
export const BETWEEN_MS = 5_000;
export const SEEN_WINDOW_MS = 60_000;
export const MIN_BUYIN_MULTIPLIER = 10;

export class RoomError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

export type RoomPhase = "idle" | "seeding" | "playing" | "between" | "closed";

export type RoomState = {
  phase: RoomPhase;
  handNo: number;
  handId: string | null;
  commit: string | null;
  /** 이번 판 참가자 (user id) */
  players: string[];
  /** 참가자가 낸 client seed */
  seeds: Record<string, string>;
  /** 다음 판 보스 = 직전 판 메인 팟 승자 */
  bossId: string | null;
  game: GameState | null;
  log: GameAction[];
  /** 이번 판에 직접 액션한 사람 / 시간 초과 횟수 → 한 판 내내 응답 없으면 자동으로 일어섬 */
  voluntary: Record<string, boolean>;
  timeouts: Record<string, number>;
};

type RoomRow = {
  id: string;
  name: string;
  game: GameKind;
  base_bet: number;
  max_seats: number;
  host_id: string | null;
  status: string;
};

type SeatRow = {
  room_id: string;
  seat_no: number;
  user_id: string;
  seat_session_id: string;
  stack: number;
  hand_contrib: number;
  hand_start_stack: number | null;
  status: "sitting" | "away";
  last_seen_at: Date;
};

type Ctx = {
  tx: Tx;
  now: Date;
  room: RoomRow;
  seats: SeatRow[];
  state: RoomState;
  deadline: Date | null;
  seq: number;
  events: { kind: string; payload: Record<string, unknown> }[];
};

const initialState = (): RoomState => ({
  phase: "idle",
  handNo: 0,
  handId: null,
  commit: null,
  players: [],
  seeds: {},
  bossId: null,
  game: null,
  log: [],
  voluntary: {},
  timeouts: {},
});

function pgCode(e: unknown): string | undefined {
  return typeof e === "object" && e !== null && "code" in e ? String((e as { code: unknown }).code) : undefined;
}

async function withRoom<T>(roomId: string, fn: (ctx: Ctx) => Promise<T> | T): Promise<T> {
  const sql = engineDb();
  try {
    // postgres.js는 반환 타입을 UnwrapPromiseArray<T>로 감싼다. T에 배열 Promise를 넣지 않으므로 T와 같다.
    return (await sql.begin(async (tx) => {
      const [{ now }] = await tx<{ now: Date }[]>`select now() as now`;
      const [rs] = await tx<{ seq: number; state: RoomState; deadline: Date | null }[]>`
        select seq, state, deadline from private.room_state where room_id = ${roomId} for update`;
      if (!rs) throw new RoomError("방이 없어요.", 404);
      const [room] = await tx<RoomRow[]>`select * from public.rooms where id = ${roomId} for update`;
      const seats = await tx<SeatRow[]>`
        select * from public.room_seats where room_id = ${roomId} order by seat_no for update`;
      const ctx: Ctx = { tx, now, room, seats: [...seats], state: rs.state, deadline: rs.deadline, seq: rs.seq, events: [] };
      const result = await fn(ctx);
      if (ctx.events.length > 0) {
        const seq = rs.seq + ctx.events.length;
        await tx`update private.room_state
                 set seq = ${seq}, state = ${tx.json(ctx.state as never)}, deadline = ${ctx.deadline}
                 where room_id = ${roomId}`;
        for (const [i, e] of ctx.events.entries()) {
          await tx`insert into public.room_events (room_id, seq, kind, payload)
                   values (${roomId}, ${rs.seq + i + 1}, ${e.kind}, ${tx.json(e.payload as never)})`;
        }
        await tx`update public.rooms set last_activity_at = now() where id = ${roomId}`;
      }
      return result;
    })) as T;
  } catch (e) {
    if (e instanceof RoomError) throw e;
    const code = pgCode(e);
    if (code === "P0001") throw new RoomError("포인트가 모자라요.", 400);
    if (code === "P0005") throw new RoomError("관리자는 카드 방에 앉을 수 없어요.", 403);
    if (code === "23505") throw new RoomError("이미 처리된 요청이에요.", 409);
    if (code === "P0006") {
      console.error("blackjack settlement rejected", roomId, e);
      throw new RoomError("정산 기록이 맞지 않아요.", 500);
    }
    throw e;
  }
}

function emit(ctx: Ctx, kind: string, payload: Record<string, unknown> = {}) {
  ctx.events.push({ kind, payload });
}

function seatOf(ctx: Ctx, userId: string): SeatRow | undefined {
  return ctx.seats.find((s) => s.user_id === userId);
}

function inHand(ctx: Ctx, userId: string): boolean {
  return (ctx.state.phase === "seeding" || ctx.state.phase === "playing") && ctx.state.players.includes(userId);
}

function eligibleSeats(ctx: Ctx): SeatRow[] {
  const seenAfter = ctx.now.getTime() - SEEN_WINDOW_MS;
  return ctx.seats.filter(
    (s) => s.status === "sitting" && s.stack >= ctx.room.base_bet && new Date(s.last_seen_at).getTime() >= seenAfter,
  );
}

const after = (ctx: Ctx, ms: number) => new Date(ctx.now.getTime() + ms);

// ── 방 만들기 · 앉기 · 일어서기 ─────────────────────────────

export async function createRoom(
  userId: string,
  input: { name: string; baseBet: number; maxSeats: number; game?: string },
) {
  const name = input.name.trim();
  const game = (input.game ?? "sutda") as GameKind;
  if (!GAME_KINDS.includes(game)) throw new RoomError("없는 게임이에요.");
  if (name.length < 1 || name.length > 30) throw new RoomError("방 이름은 1~30자예요.");
  if (!Number.isSafeInteger(input.baseBet) || input.baseBet < 1 || input.baseBet > 100_000) {
    throw new RoomError("기본금은 1~100,000P예요.");
  }
  if (!Number.isInteger(input.maxSeats) || input.maxSeats < 2 || input.maxSeats > 6) throw new RoomError("인원은 2~6명이에요.");
  if (game === "blackjack" && (input.baseBet < 10 || input.baseBet % 2 !== 0)) {
    throw new RoomError("블랙잭 기본금은 10P 이상 짝수예요.");
  }
  const sql = engineDb();
  return sql.begin(async (tx) => {
    const [room] = await tx<{ id: string }[]>`
      insert into public.rooms (name, game, base_bet, max_seats, host_id)
      values (${name}, ${game}, ${input.baseBet}, ${input.maxSeats}, ${userId}) returning id`;
    await tx`insert into private.room_state (room_id, state) values (${room.id}, ${tx.json(initialState() as never)})`;
    return room.id;
  });
}

export function sit(userId: string, roomId: string, buyIn: number) {
  return withRoom(roomId, async (ctx) => {
    if (ctx.room.status === "closed") throw new RoomError("닫힌 방이에요.", 409);
    if (seatOf(ctx, userId)) throw new RoomError("이미 앉아 있어요.", 409);
    if (ctx.seats.length >= ctx.room.max_seats) throw new RoomError("자리가 없어요.", 409);
    const min = ctx.room.base_bet * MIN_BUYIN_MULTIPLIER;
    if (!Number.isSafeInteger(buyIn) || buyIn < min) throw new RoomError(`최소 ${min.toLocaleString("ko-KR")}P를 가져와야 해요.`);
    const taken = new Set(ctx.seats.map((s) => s.seat_no));
    const seatNo = [...Array(ctx.room.max_seats).keys()].find((n) => !taken.has(n))!;
    const [seat] = await ctx.tx<SeatRow[]>`
      insert into public.room_seats (room_id, seat_no, user_id, stack)
      values (${roomId}, ${seatNo}, ${userId}, ${buyIn}) returning *`;
    await ctx.tx`select private.table_buyin(${userId}, ${seat.seat_session_id}, ${buyIn})`;
    // 방장이 없거나 방장이 자리에 없으면(방만 만들고 안 앉은 경우 포함) 이번에 앉은 사람이 방장
    const hostSeated = ctx.seats.some((s) => s.user_id === ctx.room.host_id);
    ctx.seats.push(seat);
    ctx.seats.sort((a, b) => a.seat_no - b.seat_no);
    if (!ctx.room.host_id || !hostSeated) {
      await ctx.tx`update public.rooms set host_id = ${userId} where id = ${roomId}`;
      ctx.room.host_id = userId;
    }
    emit(ctx, "sit", { userId, seatNo });
    return seatNo;
  });
}

async function leaveSeat(ctx: Ctx, seat: SeatRow) {
  await ctx.tx`select private.table_cashout(${seat.user_id}, ${seat.seat_session_id}, ${seat.stack})`;
  await ctx.tx`delete from public.room_seats where seat_session_id = ${seat.seat_session_id}`;
  ctx.seats = ctx.seats.filter((s) => s.seat_session_id !== seat.seat_session_id);
  if (ctx.room.host_id === seat.user_id) {
    const next = ctx.seats[0]?.user_id ?? null;
    await ctx.tx`update public.rooms set host_id = ${next} where id = ${ctx.room.id}`;
    ctx.room.host_id = next;
  }
  emit(ctx, "stand", { userId: seat.user_id });
}

export function stand(userId: string, roomId: string) {
  return withRoom(roomId, async (ctx) => {
    const seat = seatOf(ctx, userId);
    if (!seat) throw new RoomError("앉아 있지 않아요.", 409);
    if (inHand(ctx, userId)) {
      // 판이 끝나면 일어선다. 자기 차례는 시간 초과 규칙대로.
      await ctx.tx`update public.room_seats set status = 'away' where seat_session_id = ${seat.seat_session_id}`;
      seat.status = "away";
      emit(ctx, "away", { userId });
      // 블랙잭 베팅 단계에서 아직 안 정했으면 이번 판은 쉬기 (기한까지 기다리지 않음)
      const g = ctx.state.game;
      if (ctx.state.phase === "playing" && g?.game === "blackjack" && g.phase === "bet" && g.seats.some((x) => x.id === userId && x.status === "waiting")) {
        await applyGame(ctx, { type: "sit_out", seatId: userId }, userId);
      }
      return "after_hand" as const;
    }
    await leaveSeat(ctx, seat);
    await closeIfEmpty(ctx);
    return "now" as const;
  });
}

async function closeIfEmpty(ctx: Ctx) {
  if (ctx.seats.length > 0 || inHandPhase(ctx)) return;
  await ctx.tx`update public.rooms set status = 'closed' where id = ${ctx.room.id}`;
  ctx.state = { ...ctx.state, phase: "closed" };
  ctx.deadline = null;
  emit(ctx, "closed");
}

const inHandPhase = (ctx: Ctx) => ctx.state.phase === "seeding" || ctx.state.phase === "playing";

// ── 판 진행 ─────────────────────────────────────────────

export function start(userId: string, roomId: string) {
  return withRoom(roomId, async (ctx) => {
    if (ctx.room.host_id !== userId) throw new RoomError("방장만 시작할 수 있어요.", 403);
    if (ctx.state.phase !== "idle" && ctx.state.phase !== "between") throw new RoomError("이미 진행 중이에요.", 409);
    const min = minPlayers(ctx.room.game);
    if (eligibleSeats(ctx).length < min) throw new RoomError(`${min}명 이상 앉아야 시작할 수 있어요.`, 409);
    await beginSeeding(ctx);
  });
}

async function beginSeeding(ctx: Ctx) {
  // 60초 넘게 화면을 안 본 좌석은 일어서고 스택을 돌려받는다 (rooms-arch 결정 6)
  const seenAfter = ctx.now.getTime() - SEEN_WINDOW_MS;
  for (const seat of [...ctx.seats]) {
    if (new Date(seat.last_seen_at).getTime() < seenAfter) await leaveSeat(ctx, seat);
  }
  if (ctx.seats.length === 0) return closeIfEmpty(ctx);
  const players = eligibleSeats(ctx);
  if (players.length < minPlayers(ctx.room.game)) {
    ctx.state = { ...ctx.state, phase: "idle", players: [] };
    ctx.deadline = null;
    await ctx.tx`update public.rooms set status = 'waiting' where id = ${ctx.room.id}`;
    emit(ctx, "idle");
    return;
  }
  const serverSeed = randomBytes(32).toString("hex");
  const handId = randomUUID();
  const handNo = ctx.state.handNo + 1;
  const commit = commitOf(serverSeed);
  await ctx.tx`insert into public.hands (id, room_id, hand_no, commit_hash) values (${handId}, ${ctx.room.id}, ${handNo}, ${commit})`;
  await ctx.tx`insert into private.hand_secrets (hand_id, server_seed) values (${handId}, ${serverSeed})`;
  await ctx.tx`update public.rooms set status = 'playing' where id = ${ctx.room.id}`;
  ctx.state = {
    ...ctx.state,
    phase: "seeding",
    handNo,
    handId,
    commit,
    players: players.map((s) => s.user_id),
    seeds: {},
    game: null,
    log: [],
    voluntary: {},
    timeouts: {},
  };
  ctx.deadline = after(ctx, SEED_MS);
  emit(ctx, "seeding", { handId, handNo, commit });
}

export function submitSeed(userId: string, roomId: string, clientSeed: string) {
  return withRoom(roomId, async (ctx) => {
    if (ctx.state.phase !== "seeding") throw new RoomError("지금은 시드를 낼 때가 아니에요.", 409);
    if (!ctx.state.players.includes(userId)) throw new RoomError("이번 판 참가자가 아니에요.", 403);
    if (!isValidClientSeed(clientSeed)) throw new RoomError("시드 형식이 맞지 않아요.");
    if (ctx.state.seeds[userId]) throw new RoomError("이미 냈어요.", 409);
    ctx.state = { ...ctx.state, seeds: { ...ctx.state.seeds, [userId]: clientSeed } };
    emit(ctx, "seed", { userId });
    if (ctx.state.players.every((id) => ctx.state.seeds[id])) await deal(ctx);
  });
}

async function deal(ctx: Ctx) {
  const s = ctx.state;
  const handId = s.handId!;
  const seeds = s.players.map((id) => ({ userId: id, clientSeed: s.seeds[id] ?? autoClientSeed(handId, id) }));
  const autoSeeded = s.players.filter((id) => !s.seeds[id]);
  const [{ server_seed: serverSeed }] = await ctx.tx<{ server_seed: string }[]>`
    select server_seed from private.hand_secrets where hand_id = ${handId}`;
  const playerSeats = ctx.seats.filter((x) => s.players.includes(x.user_id));
  const bossId =
    s.bossId && s.players.includes(s.bossId)
      ? s.bossId
      : ctx.room.host_id && s.players.includes(ctx.room.host_id)
        ? ctx.room.host_id
        : playerSeats[0].user_id;
  const game = createGame(ctx.room.game, {
    handId,
    baseBet: ctx.room.base_bet,
    bossId,
    seats: playerSeats.map((x) => ({ id: x.user_id, seatNo: x.seat_no, stack: x.stack })),
    serverSeed,
    seeds,
  });
  for (const x of playerSeats) {
    await ctx.tx`update public.room_seats set hand_start_stack = stack where seat_session_id = ${x.seat_session_id}`;
    x.hand_start_stack = x.stack;
  }
  await ctx.tx`update private.hand_secrets
               set client_seeds = ${ctx.tx.json({ seeds, autoSeeded } as never)} where hand_id = ${handId}`;
  ctx.state = { ...s, phase: "playing", bossId, game };
  emit(ctx, "deal", { handId, autoSeeded });
  ctx.deadline = null;
  // 블랙잭: 일어서기를 눌러 둔 사람은 이번 판 쉬기 (첫 쉬기가 베팅 기한을 잡는다)
  const away = game.game === "blackjack" ? playerSeats.filter((x) => x.status === "away") : [];
  if (away.length === 0) return afterGameStep(ctx);
  for (const x of away) {
    if (ctx.state.phase !== "playing") break;
    await applyGame(ctx, { type: "sit_out", seatId: x.user_id }, null);
  }
}

async function applyGame(ctx: Ctx, action: GameAction, byUser: string | null) {
  const before = ctx.state.game!;
  const prevWait = waitKind(before);
  const game = reduceGame(before, action);
  const s = ctx.state;
  const voluntary = byUser ? { ...s.voluntary, [byUser]: true } : s.voluntary;
  // 시간 초과로 대신 처리된 사람 (베팅 차례, 초이스·블랙잭 베팅을 끝까지 안 정한 사람)
  const timeouts = { ...s.timeouts };
  for (const id of timedOutBy(before, action)) timeouts[id] = (timeouts[id] ?? 0) + 1;
  // 블랙잭: 걸린 금액을 좌석에 바로 기록 (방치 청소 때 몰수 기준, 정산 때 검사 기준)
  if (game.game === "blackjack" && before.game === "blackjack") {
    for (const gs of game.seats) {
      if (gs.committed === before.seats.find((x) => x.id === gs.id)!.committed) continue;
      await ctx.tx`update public.room_seats set hand_contrib = ${gs.committed}
                   where room_id = ${ctx.room.id} and user_id = ${gs.id}`;
      const row = seatOf(ctx, gs.id);
      if (row) row.hand_contrib = gs.committed;
    }
  }
  ctx.state = { ...s, game, log: [...s.log, action], voluntary, timeouts };
  emit(ctx, "action", { type: action.type, seatId: "seatId" in action ? action.seatId : null });
  await afterGameStep(ctx, prevWait);
}

async function afterGameStep(ctx: Ctx, prevWait?: ReturnType<typeof waitKind>) {
  const game = ctx.state.game!;
  if (isDone(game)) return endHand(ctx);
  const wait = waitKind(game);
  // 동시 선택(초이스·재경기 참여·블랙잭 베팅)은 한 사람이 정해도 모두의 기한이 그대로다
  if (ctx.deadline && prevWait === wait && (wait === "choice" || wait === "rejoin" || wait === "bet")) return;
  ctx.deadline = after(ctx, wait === "rejoin" ? REJOIN_MS : wait === "choice" ? CHOICE_MS : wait === "bet" ? BET_MS : TURN_MS);
}

async function endHand(ctx: Ctx) {
  const s = ctx.state;
  const game = s.game!;
  const handId = s.handId!;
  // 검증 정보에 쓸 판 시작 스택 (아래에서 hand_start_stack을 지우기 전에 기록)
  const startSeats = ctx.seats
    .filter((x) => s.players.includes(x.user_id))
    .map((x) => ({ id: x.user_id, seatNo: x.seat_no, stack: x.hand_start_stack! }));
  if (game.game === "blackjack") {
    // 하우스 정산은 함수 하나로 (스택 변경 + 정산 기록, blackjack-arch 결정 1). 돌려받은 스택으로 아래 자동 일어서기를 한다.
    const rows = game.seats.map((g) => ({ user_id: g.id, bet_total: g.committed, delta: g.stack - g.startStack }));
    const settled = await ctx.tx<{ user_id: string; stack: number }[]>`
      select user_id, stack from private.settle_blackjack_hand(${handId}, ${ctx.tx.json(rows)})`;
    for (const r of settled) {
      const row = seatOf(ctx, r.user_id);
      if (row) {
        row.stack = Number(r.stack);
        row.hand_start_stack = null;
        row.hand_contrib = 0;
      }
    }
  } else {
    for (const gs of game.seats) {
      await ctx.tx`update public.room_seats set stack = ${gs.stack}, hand_start_stack = null
                   where room_id = ${ctx.room.id} and user_id = ${gs.id}`;
      const row = seatOf(ctx, gs.id);
      if (row) {
        row.stack = gs.stack;
        row.hand_start_stack = null;
      }
    }
  }
  const [secret] = await ctx.tx<{ server_seed: string; client_seeds: unknown }[]>`
    select server_seed, client_seeds from private.hand_secrets where hand_id = ${handId}`;
  await ctx.tx`update private.hand_secrets set action_log = ${ctx.tx.json(s.log as never)} where hand_id = ${handId}`;
  const result = summarize(game);
  const revealed = {
    game: ctx.room.game,
    rngVersion: RNG_VERSION,
    serverSeed: secret.server_seed,
    clientSeeds: secret.client_seeds,
    baseBet: ctx.room.base_bet,
    bossId: s.bossId,
    seats: startSeats,
    actionLog: s.log,
  };
  await ctx.tx`update public.hands set status = 'done', ended_at = now(),
               result = ${ctx.tx.json(result as never)}, revealed = ${ctx.tx.json(revealed as never)}
               where id = ${handId}`;
  ctx.state = { ...s, phase: "between", bossId: result.winnerId ?? s.bossId };
  emit(ctx, "hand_end", { handId, payouts: result.payouts });

  // 판이 끝나면 일어설 사람: 자리 비움 표시, 기본금보다 적은 스택, 한 판 내내 응답 없던 사람
  for (const seat of [...ctx.seats]) {
    const idle = (s.timeouts[seat.user_id] ?? 0) > 0 && !s.voluntary[seat.user_id];
    if (seat.status === "away" || seat.stack < ctx.room.base_bet || idle) await leaveSeat(ctx, seat);
  }
  if (ctx.seats.length === 0) return closeIfEmpty(ctx);
  ctx.deadline = after(ctx, BETWEEN_MS);
}

// ── 사용자 액션 · 타이머 ─────────────────────────────────

/** 섯다·포커 베팅 액션, 또는 블랙잭 bet(amount)·sit_out·hit·stand·double·split */
export function act(userId: string, roomId: string, action: LegalAction, expectedSeq: number, amount?: number) {
  return withRoom(roomId, async (ctx) => {
    if (ctx.seq !== expectedSeq) throw new RoomError("화면이 최신이 아니에요. 다시 불러올게요.", 409);
    const game = ctx.state.game;
    const legal = ctx.state.phase === "playing" && game ? legalFor(game, userId) : [];
    if (!game || legal.length === 0) throw new RoomError("내 차례가 아니에요.", 409);
    if (!legal.includes(action)) throw new RoomError("지금 할 수 없는 액션이에요.");
    if (game.game !== "blackjack") {
      return applyGame(ctx, { type: "bet", seatId: userId, action: action as BetActionType }, userId);
    }
    if (action === "bet") {
      const max = Math.min(game.seats.find((x) => x.id === userId)!.stack, MAX_BET);
      if (amount === undefined || !Number.isSafeInteger(amount) || amount % 2 !== 0 || amount < game.baseBet || amount > max) {
        throw new RoomError(`베팅은 ${game.baseBet.toLocaleString("ko-KR")}~${max.toLocaleString("ko-KR")}P 사이 짝수로 해 주세요.`);
      }
      return applyGame(ctx, { type: "bet", seatId: userId, amount }, userId);
    }
    if (action === "sit_out") return applyGame(ctx, { type: "sit_out", seatId: userId }, userId);
    return applyGame(ctx, { type: "move", seatId: userId, move: action as BjMove }, userId);
  });
}

export function rejoin(userId: string, roomId: string, join: boolean) {
  return withRoom(roomId, async (ctx) => {
    const game = ctx.state.game;
    if (ctx.state.phase !== "playing" || game?.game !== "sutda" || game.phase !== "rejoin") throw new RoomError("재경기 참여를 정할 때가 아니에요.", 409);
    if (!game.rejoin!.candidates.includes(userId) || game.rejoin!.decided.includes(userId)) {
      throw new RoomError("참여를 정할 수 없어요.", 409);
    }
    await applyGame(ctx, { type: "rejoin", seatId: userId, join }, userId);
  });
}

/** 7포커 초이스: 4장 중 버릴 카드 1장, 공개할 카드 1장 */
export function choose(userId: string, roomId: string, discard: PokerCard, open: PokerCard) {
  return withRoom(roomId, async (ctx) => {
    const game = ctx.state.game;
    if (ctx.state.phase !== "playing" || game?.game !== "poker7" || game.phase !== "choice") {
      throw new RoomError("지금은 카드를 고를 때가 아니에요.", 409);
    }
    if (!game.seats.some((s) => s.id === userId) || game.chosen.includes(userId)) throw new RoomError("카드를 고를 수 없어요.", 409);
    await applyGame(ctx, { type: "choose", seatId: userId, discard, open }, userId);
  });
}

/** 기한이 지났으면 자동 진행. 여러 명이 동시에 불러도 잠금 때문에 한 번만 적용된다. 한 번에 한 단계만. */
export function tick(roomId: string) {
  return withRoom(roomId, async (ctx) => {
    if (!ctx.deadline || ctx.now < new Date(ctx.deadline)) return false;
    const s = ctx.state;
    if (s.phase === "seeding") await deal(ctx);
    else if (s.phase === "playing" && s.game) await applyGame(ctx, timeoutAction(s.game), null); else if (s.phase === "between") await beginSeeding(ctx);
    else return false;
    return true;
  });
}

// ── 조회 (본인 시점) ─────────────────────────────────────

export type RoomView = {
  room: { id: string; name: string; game: GameKind; baseBet: number; maxSeats: number; hostId: string | null; status: string };
  seq: number;
  phase: RoomPhase;
  serverNow: string;
  deadline: string | null;
  handId: string | null;
  handNo: number;
  commit: string | null;
  players: string[];
  seedsSubmitted: string[];
  needSeed: boolean;
  seats: { seatNo: number; userId: string; username: string; stack: number; status: string }[];
  game: GameView | null;
  legal: LegalAction[];
  me: string;
};

export async function getRoomView(userId: string, roomId: string): Promise<RoomView> {
  const sql = engineDb();
  const [row] = await sql<{ seq: number; state: RoomState; deadline: Date | null; now: Date }[]>`
    select seq, state, deadline, now() as now from private.room_state where room_id = ${roomId}`;
  if (!row) throw new RoomError("방이 없어요.", 404);
  const [room] = await sql<RoomRow[]>`select * from public.rooms where id = ${roomId}`;
  const seats = await sql<(SeatRow & { username: string })[]>`
    select s.*, p.username from public.room_seats s join public.profiles p on p.id = s.user_id
    where s.room_id = ${roomId} order by s.seat_no`;
  // 접속 표시 (30초에 한 번만 기록)
  await sql`update public.room_seats set last_seen_at = now()
            where room_id = ${roomId} and user_id = ${userId} and last_seen_at < now() - interval '30 seconds'`;

  const s = row.state;
  const game = s.game ? viewGame(s.game, userId) : null;
  const liveStack = (id: string, fallback: number) =>
    s.phase === "playing" && s.game ? (s.game.seats.find((g) => g.id === id)?.stack ?? fallback) : fallback;
  return {
    room: {
      id: room.id,
      name: room.name,
      game: room.game,
      baseBet: room.base_bet,
      maxSeats: room.max_seats,
      hostId: room.host_id,
      status: room.status,
    },
    seq: row.seq,
    phase: s.phase,
    serverNow: row.now.toISOString(),
    deadline: row.deadline ? new Date(row.deadline).toISOString() : null,
    handId: s.handId,
    handNo: s.handNo,
    commit: s.commit,
    players: s.players,
    seedsSubmitted: Object.keys(s.seeds),
    needSeed: s.phase === "seeding" && s.players.includes(userId) && !s.seeds[userId],
    seats: seats.map((x) => ({
      seatNo: x.seat_no,
      userId: x.user_id,
      username: x.username,
      stack: liveStack(x.user_id, x.stack),
      status: x.status,
    })),
    game,
    legal: s.phase === "playing" && s.game ? legalFor(s.game, userId) : [],
    me: userId,
  };
}
