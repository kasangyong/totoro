import { afterAll, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { replay } from "../lib/engine/replay";
import { createPoker7Hand, reducePoker7, type Poker7Action } from "../lib/engine/poker7/game";
import { engineDb } from "../lib/rooms/db";
import { act, choose, createRoom, getRoomView, rejoin, sit, start, submitSeed, tick } from "../lib/rooms/service";
import { cardGame, createUser, sql } from "./helpers";

const db = sql();
afterAll(async () => {
  await db.end();
  await engineDb().end();
});

async function balance(id: string): Promise<number> {
  const [r] = await db`select balance::int as b from public.profiles where id = ${id}`;
  return r.b;
}

async function pokerTable(n: number) {
  const users = await Promise.all(Array.from({ length: n }, () => createUser()));
  const ids = users.map((u) => u.id);
  const roomId = await createRoom(ids[0], { name: "포커방", baseBet: 10, maxSeats: 6, game: "poker7" });
  for (const id of ids) await sit(id, roomId, 1000);
  await start(ids[0], roomId);
  for (const id of ids) await submitSeed(id, roomId, randomBytes(16).toString("hex"));
  return { ids, roomId };
}

describe("7포커 방", () => {
  it("runs choice → 4구~7구 → showdown, hides others' cards and conserves points", async () => {
    const { ids, roomId } = await pokerTable(3);
    let v = await getRoomView(ids[0], roomId);
    expect(v.room.game).toBe("poker7");
    expect(cardGame(v).game).toBe("poker7");
    expect(cardGame(v).phase).toBe("choice");

    for (const id of ids) {
      const mine = cardGame(await getRoomView(id, roomId)).cards.filter((c) => c.ownerId === id).map((c) => c.card!);
      expect(mine).toHaveLength(4);
      const others = cardGame(await getRoomView(id, roomId)).cards.filter((c) => c.ownerId !== id);
      expect(others.every((c) => c.card === null)).toBe(true);
      await choose(id, roomId, mine[0], mine[1]);
    }
    v = await getRoomView(ids[1], roomId);
    expect(cardGame(v).phase).toBe("bet");
    expect(JSON.stringify(v)).not.toMatch(/"deck"|choices|serverSeed/);

    for (let i = 0; i < 60 && v.phase === "playing"; i++) {
      const turn = cardGame(v).round.toActId!;
      const mine = await getRoomView(turn, roomId);
      await act(turn, roomId, mine.legal.includes("check") ? "check" : "call", mine.seq);
      v = await getRoomView(ids[0], roomId);
    }
    expect(v.phase).toBe("between");
    const wallets = (await Promise.all(ids.map(balance))).reduce((a, b) => a + b, 0);
    expect(wallets + v.seats.reduce((a, s) => a + s.stack, 0)).toBe(30000);

    const [hand] = await db`select revealed, result from public.hands where id = ${v.handId}`;
    expect(hand.revealed.game).toBe("poker7");
    const r = hand.revealed;
    const final = replay(
      createPoker7Hand({ handId: v.handId!, baseBet: r.baseBet, seats: r.seats, serverSeed: r.serverSeed, seeds: r.clientSeeds.seeds }),
      reducePoker7,
      r.actionLog as Poker7Action[],
    );
    expect(final.result!.payouts).toEqual(hand.result.payouts);
    expect(Object.keys(hand.result.hands)).toHaveLength(3);
  });

  it("auto-chooses for players who miss the choice deadline", async () => {
    const { ids, roomId } = await pokerTable(2);
    const mine = cardGame(await getRoomView(ids[0], roomId)).cards.filter((c) => c.ownerId === ids[0]).map((c) => c.card!);
    await choose(ids[0], roomId, mine[0], mine[1]);
    await db`update private.room_state set deadline = now() - interval '1 second' where room_id = ${roomId}`;
    expect(await tick(roomId)).toBe(true);
    const v = await getRoomView(ids[1], roomId);
    expect(cardGame(v).phase).toBe("bet");
  });

  it("keeps one shared choice deadline instead of extending it on every choice", async () => {
    const { ids, roomId } = await pokerTable(3);
    const before = (await getRoomView(ids[0], roomId)).deadline;
    const mine = cardGame(await getRoomView(ids[0], roomId)).cards.filter((c) => c.ownerId === ids[0]).map((c) => c.card!);
    await new Promise((r) => setTimeout(r, 1100));
    await choose(ids[0], roomId, mine[0], mine[1]);
    expect((await getRoomView(ids[1], roomId)).deadline).toBe(before);
  });

  it("counts a missed choice as a timeout so idle players stand up after the hand", async () => {
    const { ids, roomId } = await pokerTable(2);
    await db`update private.room_state set deadline = now() - interval '1 second' where room_id = ${roomId}`;
    await tick(roomId);
    const [{ state }] = await db`select state from private.room_state where room_id = ${roomId}`;
    expect(state.timeouts).toEqual({ [ids[0]]: 1, [ids[1]]: 1 });
  });

  it("rejects 섯다-only and out-of-phase requests", async () => {
    const { ids, roomId } = await pokerTable(2);
    await expect(rejoin(ids[0], roomId, true)).rejects.toThrow(/재경기/);
    const v = await getRoomView(ids[0], roomId);
    await expect(act(ids[0], roomId, "check", v.seq)).rejects.toThrow(/차례/);
    const mine = cardGame(v).cards.filter((c) => c.ownerId === ids[0]).map((c) => c.card!);
    await choose(ids[0], roomId, mine[0], mine[1]);
    await expect(choose(ids[0], roomId, mine[2], mine[3])).rejects.toThrow(/고를 수 없어요/);
  });
});
