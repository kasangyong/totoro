import { afterAll, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import type { SutdaView } from "../lib/engine/sutda/game";
import { engineDb } from "../lib/rooms/db";
import { act, createRoom, getRoomView, openCard, pickCards, sit, start, submitSeed, tick, type RoomView } from "../lib/rooms/service";
import { createUser, sql } from "./helpers";

// 3장 섯다 방 — sutda3-arch.md S2
const db = sql();
afterAll(async () => {
  await db.end();
  await engineDb().end();
});

const seed = () => randomBytes(16).toString("hex");
const g = (v: RoomView) => v.game as SutdaView;

async function balance(id: string): Promise<number> {
  const [r] = await db`select balance::int as b from public.profiles where id = ${id}`;
  return r.b;
}

async function setup(n = 3, buyIn = 1000) {
  const users = await Promise.all(Array.from({ length: n }, () => createUser()));
  const ids = users.map((u) => u.id);
  const roomId = await createRoom(ids[0], { name: "3장", baseBet: 10, maxSeats: 6, game: "sutda3" });
  for (const id of ids) await sit(id, roomId, buyIn);
  return { ids, roomId };
}

async function deal(roomId: string, ids: string[]) {
  await start(ids[0], roomId);
  for (const id of ids) await submitSeed(id, roomId, seed());
}

const myCards = (v: RoomView) => g(v).cards.filter((c) => c.ownerId === v.me && c.card !== null).map((c) => c.card!);
const expire = (roomId: string) => db`update private.room_state set deadline = now() - interval '1 second' where room_id = ${roomId}`;

/** 공개·조합은 각자 직접, 베팅은 체크·콜로 판 끝까지 */
async function playOut(roomId: string, ids: string[]) {
  for (let i = 0; i < 200; i++) {
    const v = await getRoomView(ids[0], roomId);
    if (v.phase !== "playing") return v;
    const game = g(v);
    if (game.phase === "open" || game.phase === "pick") {
      for (const id of ids) {
        const mine = await getRoomView(id, roomId);
        const mg = g(mine);
        const live = mg.seats.some((s) => s.id === id && !s.folded) && mg.participants.includes(id);
        if (!live || (mg.chosen ?? []).includes(id) || mg.phase !== game.phase) continue;
        const cards = myCards(mine);
        if (game.phase === "open") await openCard(id, roomId, cards[0]);
        else await pickCards(id, roomId, [cards[1], cards[2]]);
      }
      continue;
    }
    if (game.phase === "rejoin") {
      await expire(roomId);
      await tick(roomId);
      continue;
    }
    const turn = game.round.toActId!;
    const mine = await getRoomView(turn, roomId);
    await act(turn, roomId, mine.legal.includes("check") ? "check" : "call", mine.seq);
  }
  throw new Error("hand did not finish");
}

describe("3장 섯다 방", () => {
  it("plays a full hand with open and pick, keeps choices hidden and conserves points", async () => {
    const { ids, roomId } = await setup(3);
    const before = (await Promise.all(ids.map(balance))).reduce((a, b) => a + b, 0) + 3000;
    await deal(roomId, ids);
    let v = await getRoomView(ids[0], roomId);
    expect(g(v).variant).toBe(3);
    expect(g(v).phase).toBe("open");
    expect(myCards(v)).toHaveLength(2);

    const first = myCards(v)[0];
    await openCard(ids[0], roomId, first);
    await expect(openCard(ids[0], roomId, first)).rejects.toThrow(/고를 수 없어요/);
    const other = await getRoomView(ids[1], roomId);
    expect(g(other).cards.filter((c) => c.ownerId === ids[0]).every((c) => c.card === null)).toBe(true);
    expect(g(other).chosen).toEqual([ids[0]]);
    expect(JSON.stringify(other)).not.toMatch(/"opens"|"picks"|decks|server_seed/);
    expect(g(await getRoomView(ids[0], roomId)).myOpen).toBe(first);

    // 남은 사람 공개 → 1차 베팅 → 3장째 → 조합
    for (const id of ids.slice(1)) await openCard(id, roomId, myCards(await getRoomView(id, roomId))[0]);
    v = await getRoomView(ids[0], roomId);
    expect(g(v).phase).toBe("bet1");
    for (let i = 0; i < 10 && g(v).phase === "bet1"; i++) {
      const turn = g(v).round.toActId!;
      const mine = await getRoomView(turn, roomId);
      await act(turn, roomId, "check", mine.seq);
      v = await getRoomView(ids[0], roomId);
    }
    expect(g(v).phase).toBe("pick");
    const three = myCards(v);
    expect(three).toHaveLength(3);
    await expect(pickCards(ids[0], roomId, [three[0], three[0]])).rejects.toThrow(/2장/);
    await pickCards(ids[0], roomId, [three[0], three[2]]);
    const peek = await getRoomView(ids[1], roomId);
    expect(JSON.stringify(peek)).not.toMatch(/"picks"/);
    expect(g(peek).myPick).toBeNull();
    expect(g(await getRoomView(ids[0], roomId)).myPick).toEqual([three[0], three[2]].sort((a, b) => a - b));

    const end = await playOut(roomId, ids);
    expect(end.phase).toBe("between");
    const stacks = end.seats.reduce((a, s) => a + s.stack, 0);
    const wallets = (await Promise.all(ids.map(balance))).reduce((a, b) => a + b, 0);
    expect(wallets + stacks).toBe(before);
    const [hand] = await db`select revealed from public.hands where id = ${end.handId}`;
    expect(hand.revealed.game).toBe("sutda3");
  });

  it("applies an expired choice deadline once under concurrent ticks", async () => {
    const { ids, roomId } = await setup(2);
    await deal(roomId, ids);
    await expire(roomId);
    const results = await Promise.all(Array.from({ length: 5 }, () => tick(roomId)));
    expect(results.filter(Boolean)).toHaveLength(1);
    const [{ state }] = await db`select state from private.room_state where room_id = ${roomId}`;
    expect(state.log).toEqual([{ type: "choice_timeout" }]);
    expect(state.game.phase).toBe("bet1");
  });

  it("gives pick a fresh deadline even when the first bet is skipped (everyone all-in)", async () => {
    const { ids, roomId } = await setup(2);
    // 스택 = 기본금 → 앤티로 바로 올인, 1차 베팅이 생기지 않는다.
    // 최소 바이인 때문에 정상 경로로는 못 만들어 스택을 직접 줄인다 → 이 방은 원장과 스택이 어긋나므로 보존식을 보지 않는다.
    // (테스트 DB 전체 합계를 보는 테스트를 만들면 이 방은 빼야 한다)
    await db`update public.room_seats set stack = 10 where room_id = ${roomId}`;
    await deal(roomId, ids);
    await expire(roomId);
    await tick(roomId); // 공개 시간 초과 → 1차 베팅 없이 바로 조합
    const [rs] = await db`select state, deadline, now() as now from private.room_state where room_id = ${roomId}`;
    expect(rs.state.game.phase).toBe("pick");
    const left = new Date(rs.deadline).getTime() - new Date(rs.now).getTime();
    expect(left).toBeGreaterThan(14_000); // CHOICE_MS 15초 (TURN_MS 20초가 아님)
    expect(left).toBeLessThan(15_500);
  });

  it("counts choice timeouts only for players who did not choose, without extending the deadline", async () => {
    const { ids, roomId } = await setup(2);
    await deal(roomId, ids);
    const [{ deadline: d1 }] = await db`select deadline from private.room_state where room_id = ${roomId}`;
    await openCard(ids[0], roomId, myCards(await getRoomView(ids[0], roomId))[0]);
    const [{ deadline: d2 }] = await db`select deadline from private.room_state where room_id = ${roomId}`;
    expect(d2).toEqual(d1);
    await expire(roomId);
    await tick(roomId);
    let [{ state }] = await db`select state from private.room_state where room_id = ${roomId}`;
    expect(state.timeouts).toEqual({ [ids[1]]: 1 });
    // 1차 베팅은 둘 다 직접 → 조합에서 다시 p1만 시간 초과
    for (let i = 0; i < 4; i++) {
      const v = await getRoomView(ids[0], roomId);
      if (g(v).phase !== "bet1") break;
      const turn = g(v).round.toActId!;
      await act(turn, roomId, "check", (await getRoomView(turn, roomId)).seq);
    }
    expect(g(await getRoomView(ids[0], roomId)).phase).toBe("pick");
    const three = myCards(await getRoomView(ids[0], roomId));
    await pickCards(ids[0], roomId, [three[0], three[1]]);
    await expire(roomId);
    await tick(roomId);
    [{ state }] = await db`select state from private.room_state where room_id = ${roomId}`;
    expect(state.timeouts).toEqual({ [ids[1]]: 2 });
    expect(state.game.phase).toBe("bet2");
  });

  it("rejects choices from folded players, outsiders and foreign cards, and events carry no cards", async () => {
    const { ids, roomId } = await setup(3);
    const outsider = await createUser();
    await deal(roomId, ids);
    const v0 = await getRoomView(ids[0], roomId);
    const foreign = myCards(await getRoomView(ids[1], roomId))[0];
    await expect(openCard(ids[0], roomId, foreign)).rejects.toThrow(/내 카드가 아니에요/);
    await expect(openCard(outsider.id, roomId, myCards(v0)[0])).rejects.toThrow(/고를 수 없어요/);
    await expect(pickCards(ids[0], roomId, [0, 1])).rejects.toThrow(/고를 때가 아니에요/);
    for (const id of ids) await openCard(id, roomId, myCards(await getRoomView(id, roomId))[0]);
    // 1차 베팅: 첫 사람 체크, 그다음 사람 다이, 나머지 체크
    let v = await getRoomView(ids[0], roomId);
    let folded: string | null = null;
    for (let i = 0; i < 6 && g(v).phase === "bet1"; i++) {
      const turn = g(v).round.toActId!;
      const mine = await getRoomView(turn, roomId);
      const action = folded === null && i > 0 ? "die" : mine.legal.includes("check") ? "check" : "call";
      if (action === "die") folded = turn;
      await act(turn, roomId, action, mine.seq);
      v = await getRoomView(ids[0], roomId);
    }
    expect(g(v).phase).toBe("pick");
    const fc = myCards(await getRoomView(folded!, roomId));
    await expect(pickCards(folded!, roomId, [fc[0], fc[1]])).rejects.toThrow(/고를 수 없어요/);
    const events = await db`select payload from public.room_events where room_id = ${roomId}`;
    expect(JSON.stringify(events)).not.toMatch(/"(card|cards|opens|picks|decks)"/);
  });

  it("stands up a player who never chose anything during the hand", async () => {
    const { ids, roomId } = await setup(2);
    await deal(roomId, ids);
    for (let i = 0; i < 40; i++) {
      const v = await getRoomView(ids[0], roomId);
      if (v.phase !== "playing") break;
      const game = g(v);
      if (game.phase === "open" && !(game.chosen ?? []).includes(ids[0])) await openCard(ids[0], roomId, myCards(v)[0]);
      else if (game.phase === "pick" && !(game.chosen ?? []).includes(ids[0])) await pickCards(ids[0], roomId, [myCards(v)[0], myCards(v)[1]]);
      else if (game.round.toActId === ids[0]) await act(ids[0], roomId, v.legal.includes("check") ? "check" : "call", v.seq);
      else {
        await expire(roomId); // p1은 아무것도 안 함 → 시간 초과로만 진행
        await tick(roomId);
      }
    }
    const end = await getRoomView(ids[0], roomId);
    expect(end.phase).toBe("between");
    expect(end.seats.map((s) => s.userId)).toEqual([ids[0]]);
    expect(await balance(ids[1])).toBeGreaterThan(9000);
  });
});
