import { afterAll, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import type { BlackjackView } from "../lib/engine/blackjack/game";
import { engineDb } from "../lib/rooms/db";
import { act, createRoom, getRoomView, sit, stand, start, submitSeed, tick, type RoomView } from "../lib/rooms/service";
import { createUser, sql } from "./helpers";

const db = sql();
afterAll(async () => {
  await db.end();
  await engineDb().end();
});

const seed = () => randomBytes(16).toString("hex");
const bj = (v: RoomView) => v.game as BlackjackView;

async function balance(id: string): Promise<number> {
  const [r] = await db`select balance::int as b from public.profiles where id = ${id}`;
  return r.b;
}

async function setup(n = 1, buyIn = 1000) {
  const users = await Promise.all(Array.from({ length: n }, () => createUser()));
  const roomId = await createRoom(users[0].id, { name: "블랙잭", baseBet: 10, maxSeats: 6, game: "blackjack" });
  for (const u of users) await sit(u.id, roomId, buyIn);
  const ids = users.map((u) => u.id);
  await start(ids[0], roomId);
  for (const id of ids) await submitSeed(id, roomId, seed());
  return { ids, roomId };
}

/** 베팅까지 마치고 턴이 남은 판 (딜러·참가자 블랙잭으로 바로 끝나면 새 방으로 다시) */
async function setupPlaying(n: number, amount: number) {
  for (let attempt = 0; attempt < 15; attempt++) {
    const { ids, roomId } = await setup(n);
    await betAll(roomId, ids, amount);
    const v = await getRoomView(ids[0], roomId);
    if (v.phase === "playing" && bj(v).phase === "play") return { ids, roomId, v };
  }
  throw new Error("never got a hand that needs turns");
}

async function betAll(roomId: string, ids: string[], amount = 20) {
  for (const id of ids) {
    const v = await getRoomView(id, roomId);
    if (v.legal.includes("bet")) await act(id, roomId, "bet", v.seq, amount);
  }
}

/** 차례인 사람이 스탠드로 판 끝까지 */
async function standOut(roomId: string, ids: string[]) {
  for (let i = 0; i < 50; i++) {
    const v = await getRoomView(ids[0], roomId);
    if (v.phase !== "playing") return v;
    const turn = bj(v).toAct?.seatId;
    if (!turn) throw new Error("no one to act");
    const mine = await getRoomView(turn, roomId);
    await act(turn, roomId, "stand", mine.seq);
  }
  throw new Error("hand did not finish");
}

/** 블랙잭 방 보존식: Σbuyin − Σcashout + Σ하우스 정산 = Σ스택 */
async function conserved(roomId: string, ids: string[]) {
  const [l] = await db`
    select coalesce(sum(-delta), 0)::int as net from public.ledger
    where user_id in ${db(ids)} and kind in ('table_buyin', 'table_cashout')`;
  const [h] = await db`
    select coalesce(sum(hs.delta), 0)::int as house from private.house_settlements hs
    join public.hands ha on ha.id = hs.hand_id where ha.room_id = ${roomId}`;
  const [s] = await db`select coalesce(sum(stack), 0)::int as stacks from public.room_seats where room_id = ${roomId}`;
  expect(l.net + h.house).toBe(s.stacks);
}

describe("blackjack rooms", () => {
  it("rejects odd or too-small base bets", async () => {
    const u = await createUser();
    await expect(createRoom(u.id, { name: "x", baseBet: 11, maxSeats: 6, game: "blackjack" })).rejects.toThrow(/짝수/);
    await expect(createRoom(u.id, { name: "x", baseBet: 8, maxSeats: 6, game: "blackjack" })).rejects.toThrow(/짝수/);
    await expect(db`insert into public.rooms (name, game, base_bet, max_seats) values ('x', 'blackjack', 11, 6)`).rejects.toThrow();
  });

  it("plays a solo hand, settles with the house and keeps the conservation law", async () => {
    const { ids, roomId } = await setup(1);
    let v = await getRoomView(ids[0], roomId);
    expect(v.legal).toEqual(["bet", "sit_out"]);
    await expect(act(ids[0], roomId, "bet", v.seq, 21)).rejects.toThrow(/짝수/);
    await act(ids[0], roomId, "bet", v.seq, 20);
    v = await getRoomView(ids[0], roomId);
    expect(JSON.stringify(v)).not.toMatch(/"(secrets|deck|hole)"|server_seed/);
    const [seat] = await db`select hand_contrib::int as c from public.room_seats where room_id = ${roomId}`;
    expect(seat.c).toBe(20);
    const end = await standOut(roomId, ids);
    expect(end.phase).toBe("between");
    const [hs] = await db`select hs.kind, hs.bet_total::int as bet, hs.delta::int as delta from private.house_settlements hs
                          join public.hands ha on ha.id = hs.hand_id where ha.room_id = ${roomId}`;
    expect(hs.kind).toBe("settle");
    expect(hs.bet).toBe(20);
    expect(end.seats[0].stack).toBe(1000 + hs.delta);
    const [after] = await db`select hand_contrib::int as c, hand_start_stack from public.room_seats where room_id = ${roomId}`;
    expect(after).toEqual({ c: 0, hand_start_stack: null });
    await conserved(roomId, ids);
  });

  it("records doubles in hand_contrib and settles the whole amount", async () => {
    for (let attempt = 0; attempt < 10; attempt++) {
      const { ids, roomId } = await setup(1);
      await betAll(roomId, ids, 20);
      const v = await getRoomView(ids[0], roomId);
      if (!v.legal.includes("double")) continue; // 블랙잭이 나오거나 딜러 블랙잭이면 다시
      await act(ids[0], roomId, "double", v.seq);
      const [hs] = await db`select hs.bet_total::int as bet from private.house_settlements hs
                            join public.hands ha on ha.id = hs.hand_id where ha.room_id = ${roomId}`;
      expect(hs.bet).toBe(40);
      await conserved(roomId, ids);
      return;
    }
    throw new Error("never got a doubleable hand");
  });

  it("rejects settlements that do not match the seats and double settlement", async () => {
    const { ids, roomId, v } = await setupPlaying(1, 20);
    const eng = engineDb();
    const call = (rows: unknown) => eng`select * from private.settle_blackjack_hand(${v.handId!}, ${eng.json(rows as never)})`;
    await expect(call([{ user_id: ids[0], bet_total: 10, delta: 0 }])).rejects.toThrow(/out of range/);
    await expect(call([{ user_id: ids[0], bet_total: 20, delta: 31 }])).rejects.toThrow(/out of range/);
    await expect(call([{ user_id: ids[0], bet_total: 20 }])).rejects.toThrow(/out of range/);
    await expect(call([])).rejects.toThrow(/missing/);
    await standOut(roomId, ids);
    // 끝난 판은 다시 정산할 수 없다
    await expect(call([{ user_id: ids[0], bet_total: 20, delta: 0 }])).rejects.toThrow(/not a playing/);
    const rows = await db`select 1 from private.house_settlements hs join public.hands ha on ha.id = hs.hand_id where ha.room_id = ${roomId}`;
    expect(rows).toHaveLength(1);
  });

  it("forfeits the amount at risk when an abandoned hand is cleaned up (no free undo)", async () => {
    const { ids, roomId } = await setupPlaying(1, 100);
    await db`update public.rooms set last_activity_at = now() - interval '11 minutes' where id = ${roomId}`;
    await db`select private.close_abandoned_rooms()`;
    expect(await balance(ids[0])).toBe(10000 - 100);
    const [hs] = await db`select hs.kind, hs.delta::int as delta from private.house_settlements hs
                          join public.hands ha on ha.id = hs.hand_id where ha.room_id = ${roomId}`;
    expect(hs).toEqual({ kind: "void", delta: -100 });
  });

  it("cashes out the settled stack when a player who stood up mid-hand leaves", async () => {
    const { ids, roomId } = await setupPlaying(2, 20);
    expect(await stand(ids[1], roomId)).toBe("after_hand");
    const end = await standOut(roomId, ids);
    expect(end.seats.map((s) => s.userId)).toEqual([ids[0]]);
    const [hs] = await db`select hs.delta::int as delta from private.house_settlements hs
                          join public.hands ha on ha.id = hs.hand_id where ha.room_id = ${roomId} and hs.user_id = ${ids[1]}`;
    expect(await balance(ids[1])).toBe(10000 + hs.delta);
    await conserved(roomId, ids);
  });

  it("sits out on stand during betting and ends a no-bet hand cleanly", async () => {
    const { ids, roomId } = await setup(1);
    expect(await stand(ids[0], roomId)).toBe("after_hand");
    const v = await getRoomView(ids[0], roomId);
    expect(v.seats).toEqual([]);
    expect(await balance(ids[0])).toBe(10000);
    const [hs] = await db`select hs.bet_total::int as bet, hs.delta::int as delta from private.house_settlements hs
                          join public.hands ha on ha.id = hs.hand_id where ha.room_id = ${roomId}`;
    expect(hs).toEqual({ bet: 0, delta: 0 });
  });

  it("applies the betting deadline once under concurrent ticks and does not extend it per bet", async () => {
    const { ids, roomId } = await setup(2);
    const [{ deadline: d1 }] = await db`select deadline from private.room_state where room_id = ${roomId}`;
    const v = await getRoomView(ids[0], roomId);
    await act(ids[0], roomId, "bet", v.seq, 20);
    const [{ deadline: d2 }] = await db`select deadline from private.room_state where room_id = ${roomId}`;
    expect(d2).toEqual(d1);
    await db`update private.room_state set deadline = now() - interval '1 second' where room_id = ${roomId}`;
    const results = await Promise.all(Array.from({ length: 5 }, () => tick(roomId)));
    expect(results.filter(Boolean)).toHaveLength(1);
    const [{ state }] = await db`select state from private.room_state where room_id = ${roomId}`;
    expect(state.log.filter((a: { type: string }) => a.type === "bet_timeout")).toHaveLength(1);
  });

  it("keeps the settlement table and function away from API roles and the engine role", async () => {
    for (const role of ["anon", "authenticated"]) {
      await expect(db.begin(async (tx) => {
        await tx.unsafe(`set local role ${role}`);
        await tx`select * from private.house_settlements`;
      })).rejects.toThrow(/permission denied/);
      await expect(db.begin(async (tx) => {
        await tx.unsafe(`set local role ${role}`);
        await tx`select * from private.settle_blackjack_hand(gen_random_uuid(), '[]'::jsonb)`;
      })).rejects.toThrow(/permission denied/);
    }
    await expect(engineDb()`select * from private.house_settlements`).rejects.toThrow(/permission denied/);
  });

  it("sits out a player who stood up during seeding, and room events carry no hidden cards", async () => {
    const users = await Promise.all([createUser(), createUser()]);
    const ids = users.map((u) => u.id);
    const roomId = await createRoom(ids[0], { name: "블랙잭", baseBet: 10, maxSeats: 6, game: "blackjack" });
    for (const id of ids) await sit(id, roomId, 1000);
    await start(ids[0], roomId);
    expect(await stand(ids[1], roomId)).toBe("after_hand");
    for (const id of ids) await submitSeed(id, roomId, seed());
    const v = await getRoomView(ids[0], roomId);
    expect(bj(v).seats.find((s) => s.id === ids[1])!.status).toBe("out");
    expect(v.legal).toEqual(["bet", "sit_out"]);
    await act(ids[0], roomId, "bet", v.seq, 20);
    await standOut(roomId, ids);
    const events = await db`select payload from public.room_events where room_id = ${roomId}`;
    expect(JSON.stringify(events)).not.toMatch(/"(deck|deckPos|hole|secrets|serverSeed|server_seed)"/);
    expect(await balance(ids[1])).toBe(10000);
  });
});
