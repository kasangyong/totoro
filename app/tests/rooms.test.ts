import { afterAll, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { replay } from "../lib/engine/replay";
import { createSutdaHand, reduceSutda, type SutdaAction } from "../lib/engine/sutda/game";
import { engineDb } from "../lib/rooms/db";
import { act, createRoom, getRoomView, sit, stand, start, submitSeed, tick, RoomError } from "../lib/rooms/service";
import { createUser, sql } from "./helpers";

const db = sql();
afterAll(async () => {
  await db.end();
  await engineDb().end();
});

const seed = () => randomBytes(16).toString("hex");

async function balance(id: string): Promise<number> {
  const [r] = await db`select balance::int as b from public.profiles where id = ${id}`;
  return r.b;
}

async function tableSetup(n = 3, buyIn = 1000) {
  const users = await Promise.all(Array.from({ length: n }, () => createUser()));
  const roomId = await createRoom(users[0].id, { name: "테스트방", baseBet: 10, maxSeats: 6 });
  for (const u of users) await sit(u.id, roomId, buyIn);
  return { users, roomId };
}

/** 모든 참가자가 시드를 내고 판을 시작 */
async function dealHand(roomId: string, ids: string[]) {
  await start(ids[0], roomId);
  for (const id of ids) await submitSeed(id, roomId, seed());
}

/** 차례인 사람이 체크 또는 콜로 판 끝까지 */
async function playOut(roomId: string, ids: string[]) {
  for (let i = 0; i < 100; i++) {
    const v = await getRoomView(ids[0], roomId);
    if (v.phase !== "playing") return v;
    if (v.game!.phase === "rejoin") {
      await db`update private.room_state set deadline = now() - interval '1 second' where room_id = ${roomId}`;
      await tick(roomId);
      continue;
    }
    const turn = v.game!.round.toActId!;
    const mine = await getRoomView(turn, roomId);
    await act(turn, roomId, mine.legal.includes("check") ? "check" : "call", mine.seq);
  }
  throw new Error("hand did not finish");
}

describe("rooms", () => {
  it("moves buy-ins from wallets to the table and back", async () => {
    const { users, roomId } = await tableSetup(2);
    expect(await balance(users[0].id)).toBe(9000);
    await stand(users[1].id, roomId);
    expect(await balance(users[1].id)).toBe(10000);
    const rows = await db`select kind, delta::int from public.ledger where user_id = ${users[1].id} order by id`;
    expect(rows.map((r) => r.kind)).toEqual(["signup_bonus", "table_buyin", "table_cashout"]);
  });

  it("rejects too-small buy-ins, double seating and admins", async () => {
    const { users, roomId } = await tableSetup(1);
    await expect(sit(users[0].id, roomId, 1000)).rejects.toThrow(RoomError);
    const other = await createUser();
    await expect(sit(other.id, roomId, 50)).rejects.toThrow(/최소/);
    const adminUser = await createUser();
    await db`update public.profiles set role = 'admin' where id = ${adminUser.id}`;
    await expect(sit(adminUser.id, roomId, 1000)).rejects.toThrow(/관리자/);
    expect(await balance(adminUser.id)).toBe(10000);
  });

  it("plays a full hand, hides other players' cards and conserves points", async () => {
    const { users, roomId } = await tableSetup(3);
    const ids = users.map((u) => u.id);
    const before = (await Promise.all(ids.map(balance))).reduce((a, b) => a + b, 0) + 3000;
    await dealHand(roomId, ids);

    const v = await getRoomView(ids[1], roomId);
    expect(v.phase).toBe("playing");
    const visible = v.game!.cards.filter((c) => c.card !== null);
    expect(visible.every((c) => c.ownerId === ids[1] || c.faceUp)).toBe(true);
    expect(JSON.stringify(v)).not.toMatch(/decks|serverSeed|server_seed/);

    const end = await playOut(roomId, ids);
    expect(end.phase).toBe("between");
    const stacks = end.seats.reduce((a, s) => a + s.stack, 0);
    const wallets = (await Promise.all(ids.map(balance))).reduce((a, b) => a + b, 0);
    expect(wallets + stacks).toBe(before);
  });

  it("publishes seeds after the hand and replays to the same result", async () => {
    const { users, roomId } = await tableSetup(2);
    const ids = users.map((u) => u.id);
    await dealHand(roomId, ids);
    const handId = (await getRoomView(ids[0], roomId)).handId!;
    const [during] = await db`select revealed from public.hands where id = ${handId}`;
    expect(during.revealed).toBeNull();
    await playOut(roomId, ids);

    const [hand] = await db`select commit_hash, revealed, result from public.hands where id = ${handId}`;
    const r = hand.revealed;
    const initial = createSutdaHand({
      handId,
      baseBet: r.baseBet,
      bossId: r.bossId,
      seats: r.seats,
      serverSeed: r.serverSeed,
      seeds: r.clientSeeds.seeds,
    });
    const final = replay(initial, reduceSutda, r.actionLog as SutdaAction[]);
    expect(final.result!.payouts).toEqual(hand.result.payouts);
  });

  it("applies an expired turn timeout exactly once under concurrent ticks", async () => {
    const { users, roomId } = await tableSetup(2);
    const ids = users.map((u) => u.id);
    await dealHand(roomId, ids);
    const before = await getRoomView(ids[0], roomId);
    await db`update private.room_state set deadline = now() - interval '1 second' where room_id = ${roomId}`;
    const results = await Promise.all(Array.from({ length: 5 }, () => tick(roomId)));
    expect(results.filter(Boolean)).toHaveLength(1);
    const [{ state }] = await db`select state from private.room_state where room_id = ${roomId}`;
    expect(state.log).toHaveLength(1);
    expect(state.log[0]).toEqual({ type: "timeout", seatId: before.game!.round.toActId });
  });

  it("rejects stale actions and actions out of turn", async () => {
    const { users, roomId } = await tableSetup(2);
    const ids = users.map((u) => u.id);
    await dealHand(roomId, ids);
    const v = await getRoomView(ids[0], roomId);
    const turn = v.game!.round.toActId!;
    const other = ids.find((id) => id !== turn)!;
    await expect(act(other, roomId, "check", v.seq)).rejects.toThrow(/차례/);
    await expect(act(turn, roomId, "check", v.seq - 1)).rejects.toThrow(/최신/);
  });

  it("voids an abandoned hand and returns every seat's starting stack", async () => {
    const { users, roomId } = await tableSetup(3);
    const ids = users.map((u) => u.id);
    await dealHand(roomId, ids);
    let v = await getRoomView(ids[0], roomId);
    await act(v.game!.round.toActId!, roomId, "ping", v.seq); // 판 중에 돈이 움직인 상태
    await db`update public.rooms set last_activity_at = now() - interval '11 minutes' where id = ${roomId}`;
    await db`select private.close_abandoned_rooms()`;
    for (const id of ids) expect(await balance(id)).toBe(10000);
    const [room] = await db`select status from public.rooms where id = ${roomId}`;
    expect(room.status).toBe("closed");
    const [hand] = await db`select status from public.hands where room_id = ${roomId}`;
    expect(hand.status).toBe("void");
    v = await getRoomView(ids[0], roomId);
    expect(v.seats).toEqual([]);
  });

  it("makes the first seated player host when the creator never sits", async () => {
    const [creator, b, c] = await Promise.all([createUser(), createUser(), createUser()]);
    const roomId = await createRoom(creator.id, { name: "안 앉는 방장", baseBet: 10, maxSeats: 6 });
    await sit(b.id, roomId, 1000);
    await sit(c.id, roomId, 1000);
    expect((await getRoomView(b.id, roomId)).room.hostId).toBe(b.id);
    await start(b.id, roomId);
    expect((await getRoomView(b.id, roomId)).phase).toBe("seeding");
  });

  it("stands up and refunds seats that have not looked at the room for a minute", async () => {
    const { users, roomId } = await tableSetup(3);
    const ids = users.map((u) => u.id);
    await db`update public.room_seats set last_seen_at = now() - interval '5 minutes' where user_id = ${ids[2]}`;
    await start(ids[0], roomId);
    const v = await getRoomView(ids[0], roomId);
    expect(v.players.sort()).toEqual([ids[0], ids[1]].sort());
    expect(v.seats.map((s) => s.userId)).not.toContain(ids[2]);
    expect(await balance(ids[2])).toBe(10000);
  });

  it("stands up players who were away or timed out a whole hand", async () => {
    const { users, roomId } = await tableSetup(2);
    const ids = users.map((u) => u.id);
    await dealHand(roomId, ids);
    expect(await stand(ids[1], roomId)).toBe("after_hand");
    const end = await playOut(roomId, ids);
    expect(end.seats.map((s) => s.userId)).toEqual([ids[0]]);
    const total = (await balance(ids[0])) + (await balance(ids[1])) + end.seats[0].stack;
    expect(total).toBe(20000);
  });
});
