import { afterAll, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { raiseBounds, type HoldemState, type HoldemView } from "../lib/engine/holdem/game";
import { engineDb } from "../lib/rooms/db";
import { act, createRoom, getRoomView, sit, stand, start, submitSeed, tick, type RoomView } from "../lib/rooms/service";
import { createUser, sql } from "./helpers";

// 홀덤 방 — holdem-arch.md H2
const db = sql();
afterAll(async () => {
  await db.end();
  await engineDb().end();
});

const seed = () => randomBytes(16).toString("hex");
const h = (v: RoomView) => v.game as HoldemView;

async function balance(id: string): Promise<number> {
  const [r] = await db`select balance::int as b from public.profiles where id = ${id}`;
  return r.b;
}

async function setup(n = 3, buyIn = 1000) {
  const users = await Promise.all(Array.from({ length: n }, () => createUser()));
  const ids = users.map((u) => u.id);
  const roomId = await createRoom(ids[0], { name: "홀덤", baseBet: 10, maxSeats: 6, game: "holdem" });
  for (const id of ids) await sit(id, roomId, buyIn);
  return { ids, roomId };
}

async function deal(roomId: string, host: string, ids: string[]) {
  await start(host, roomId);
  for (const id of ids) await submitSeed(id, roomId, seed());
}

/** 차례인 사람이 체크 또는 콜로 판 끝까지 */
async function checkDown(roomId: string, anyId: string) {
  for (let i = 0; i < 60; i++) {
    const v = await getRoomView(anyId, roomId);
    if (v.phase !== "playing") return v;
    const turn = h(v).toActId!;
    const mine = await getRoomView(turn, roomId);
    await act(turn, roomId, mine.legal.includes("check") ? "check" : "call", mine.seq);
  }
  throw new Error("hand did not finish");
}

async function stateOf(roomId: string): Promise<{ game: HoldemState; buttonSeatNo?: number }> {
  const [{ state }] = await db`select state from private.room_state where room_id = ${roomId}`;
  return state;
}

describe("홀덤 방", () => {
  it("rejects a base bet below 2", async () => {
    const u = await createUser();
    await expect(createRoom(u.id, { name: "x", baseBet: 1, maxSeats: 6, game: "holdem" })).rejects.toThrow(/2P 이상/);
    await expect(db`insert into public.rooms (name, game, base_bet, max_seats) values ('x', 'holdem', 1, 6)`).rejects.toThrow();
  });

  it("plays a hand to showdown, hides hole cards and conserves points", async () => {
    const { ids, roomId } = await setup(3);
    const before = (await Promise.all(ids.map(balance))).reduce((a, b) => a + b, 0) + 3000;
    await deal(roomId, ids[0], ids);
    const v = await getRoomView(ids[1], roomId);
    const game = h(v);
    expect(game.buttonId).toBe(ids[0]); // 첫 판 = 방장
    expect(game.holes.filter((c) => c.card !== null).every((c) => c.ownerId === ids[1])).toBe(true);
    expect(JSON.stringify(v)).not.toMatch(/"(deck|deckPos|secrets)"|server_seed/);
    const end = await checkDown(roomId, ids[0]);
    expect(end.phase).toBe("between");
    const stacks = end.seats.reduce((a, s) => a + s.stack, 0);
    const wallets = (await Promise.all(ids.map(balance))).reduce((a, b) => a + b, 0);
    expect(wallets + stacks).toBe(before);
    const [hand] = await db`select result, revealed from public.hands where id = ${end.handId}`;
    expect(hand.revealed.game).toBe("holdem");
    expect(hand.revealed.bossId).toBe(ids[0]);
    expect(Object.keys(hand.result.hands).length).toBeGreaterThanOrEqual(2);
  });

  it("validates raise amounts against the engine bounds", async () => {
    const { ids, roomId } = await setup(3);
    await deal(roomId, ids[0], ids);
    const v = await getRoomView(ids[0], roomId);
    const turn = h(v).toActId!;
    const mine = await getRoomView(turn, roomId);
    expect(mine.legal).toEqual(["fold", "call", "raise", "allin"]);
    const [{ state }] = await db`select state from private.room_state where room_id = ${roomId}`;
    const b = raiseBounds(state.game, turn)!;
    expect(b).toEqual({ min: 20, max: 1000 });
    await expect(act(turn, roomId, "raise", mine.seq, 19)).rejects.toThrow(/레이즈는 20~1,000P/);
    await expect(act(turn, roomId, "raise", mine.seq)).rejects.toThrow(/레이즈는/);
    await expect(act(turn, roomId, "raise", mine.seq, 1001)).rejects.toThrow(/레이즈는/);
    await expect(act(turn, roomId, "raise", mine.seq, 20.5)).rejects.toThrow(/레이즈는/);
    await expect(act(turn, roomId, "die", mine.seq)).rejects.toThrow(/할 수 없는/);
    await act(turn, roomId, "raise", mine.seq, 35);
    const after = await stateOf(roomId);
    expect(after.game.currentBet).toBe(35);
  });

  it("applies an expired turn timeout once under concurrent ticks", async () => {
    const { ids, roomId } = await setup(2);
    await deal(roomId, ids[0], ids);
    const turn = h(await getRoomView(ids[0], roomId)).toActId!;
    await db`update private.room_state set deadline = now() - interval '1 second' where room_id = ${roomId}`;
    const results = await Promise.all(Array.from({ length: 5 }, () => tick(roomId)));
    expect(results.filter(Boolean)).toHaveLength(1);
    const [{ state }] = await db`select state from private.room_state where room_id = ${roomId}`;
    expect(state.log).toEqual([{ type: "timeout", seatId: turn }]);
  });

  it("ends a fold-to-one hand without revealing hands", async () => {
    const { ids, roomId } = await setup(2);
    await deal(roomId, ids[0], ids);
    const turn = h(await getRoomView(ids[0], roomId)).toActId!;
    await act(turn, roomId, "fold", (await getRoomView(turn, roomId)).seq);
    const v = await getRoomView(ids[0], roomId);
    expect(v.phase).toBe("between");
    const [hand] = await db`select result from public.hands where id = ${v.handId}`;
    expect(hand.result.hands).toEqual({});
    expect(h(v).holes.every((c) => !c.faceUp)).toBe(true);
  });

  it("moves the button by seat, skipping a seat that stood up and including a new seat", async () => {
    const { ids, roomId } = await setup(3); // 좌석 0·1·2
    await deal(roomId, ids[0], ids);
    expect(h(await getRoomView(ids[0], roomId)).buttonId).toBe(ids[0]);
    await checkDown(roomId, ids[0]);
    expect((await stateOf(roomId)).buttonSeatNo).toBe(0);

    // 다음 버튼 자리(좌석 1)가 일어서면 좌석 2로
    await stand(ids[1], roomId);
    await deal(roomId, ids[0], [ids[0], ids[2]]);
    expect(h(await getRoomView(ids[0], roomId)).buttonId).toBe(ids[2]);
    await checkDown(roomId, ids[0]);

    // 비어 있던 좌석 1에 새 사람이 앉으면 한 바퀴 돌아 좌석 0 → 다음은 좌석 1
    const newcomer = await createUser();
    await sit(newcomer.id, roomId, 1000);
    await deal(roomId, ids[0], [ids[0], ids[2], newcomer.id]);
    expect(h(await getRoomView(ids[0], roomId)).buttonId).toBe(ids[0]);
    await checkDown(roomId, ids[0]);
    await deal(roomId, ids[0], [ids[0], ids[2], newcomer.id]);
    expect(h(await getRoomView(ids[0], roomId)).buttonId).toBe(newcomer.id);
  });

  it("keeps the button seat when the button stands up mid-hand", async () => {
    const { ids, roomId } = await setup(3);
    await deal(roomId, ids[0], ids);
    expect(await stand(ids[0], roomId)).toBe("after_hand");
    await checkDown(roomId, ids[1]);
    expect((await stateOf(roomId)).buttonSeatNo).toBe(0);
    const v = await getRoomView(ids[1], roomId);
    expect(v.seats.map((s) => s.userId)).toEqual([ids[1], ids[2]]);
    await deal(roomId, v.room.hostId!, [ids[1], ids[2]]);
    expect(h(await getRoomView(ids[1], roomId)).buttonId).toBe(ids[1]); // 좌석 0 다음 = 좌석 1
  });

  it("keeps folded players' cards hidden from others after the showdown, and events carry no cards", async () => {
    const { ids, roomId } = await setup(3);
    await deal(roomId, ids[0], ids);
    const first = h(await getRoomView(ids[0], roomId)).toActId!;
    await act(first, roomId, "fold", (await getRoomView(first, roomId)).seq);
    const end = await checkDown(roomId, ids[0]);
    expect(end.phase).toBe("between");
    const viewer = ids.find((id) => id !== first)!;
    const seen = h(await getRoomView(viewer, roomId)).holes.filter((c) => c.ownerId === first);
    expect(seen.every((c) => c.card === null && !c.faceUp)).toBe(true);
    const events = await db`select payload from public.room_events where room_id = ${roomId}`;
    expect(JSON.stringify(events)).not.toMatch(/"(card|cards|holes|deck)"/);
  });
});
