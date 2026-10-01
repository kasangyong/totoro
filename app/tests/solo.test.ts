import { afterAll, describe, expect, it } from "vitest";
import { playDice, soloRng } from "../lib/engine/solo/games";
import { commitOf } from "../lib/engine/rng";
import { engineDb } from "../lib/rooms/db";
import { crashBet, crashCashout, crashState } from "../lib/solo/crash-service";
import { cashoutSession, getFairness, getSession, playInstant, rotateSeed, startSession, stepSession } from "../lib/solo/service";
import { createUser, sql } from "./helpers";

const db = sql();
afterAll(async () => {
  await db.end();
  await engineDb().end();
});

async function balance(id: string): Promise<number> {
  const [r] = await db`select balance::int as b from public.profiles where id = ${id}`;
  return r.b;
}

describe("단판 게임", () => {
  it("settles dice through the ledger and replays after the seed is revealed", async () => {
    const u = await createUser();
    const before = await getFairness(u.id);
    const r = await playInstant(u.id, "dice", 100, { mode: "under", target: 50 });
    expect(r.nonce).toBe(0);
    expect(r.balance).toBe(10000 - 100 + r.result.payout);
    expect(await balance(u.id)).toBe(r.balance);
    const rows = await db`select kind, delta::int from public.ledger where user_id = ${u.id} and kind in ('bet','payout') order by id`;
    expect(rows[0]).toEqual({ kind: "bet", delta: -100 });

    const { revealedServerSeed } = await rotateSeed(u.id);
    expect(commitOf(revealedServerSeed)).toBe(before.current.commit);
    const again = playDice(
      soloRng({ serverSeed: revealedServerSeed, clientSeed: before.current.clientSeed, userId: u.id, nonce: 0 }),
      100,
      { mode: "under", target: 50 },
    );
    expect(again).toEqual({ roll: r.result.roll, win: r.result.win, mult100: r.result.mult100, payout: r.result.payout });
  });

  it("uses a unique nonce per play under concurrency and conserves points", async () => {
    const u = await createUser();
    const plays = await Promise.all(Array.from({ length: 6 }, () => playInstant(u.id, "limbo", 50, { target100: 200 })));
    expect(new Set(plays.map((p) => p.nonce)).size).toBe(6);
    const net = plays.reduce((a, p) => a + p.result.payout - 50, 0);
    expect(await balance(u.id)).toBe(10000 + net);
  });

  it("rejects bad params and too-small bets without charging", async () => {
    const u = await createUser();
    await expect(playInstant(u.id, "dice", 5, { mode: "under", target: 50 })).rejects.toThrow(/이상/);
    await expect(playInstant(u.id, "dice", 100, { mode: "under", target: 99 })).rejects.toThrow(/설정/);
    await expect(playInstant(u.id, "wheel", 100, { risk: "huge", segments: 10 })).rejects.toThrow(/설정/);
    expect(await balance(u.id)).toBe(10000);
  });

  it("plays plinko and wheel", async () => {
    const u = await createUser();
    const p = await playInstant(u.id, "plinko", 100, { rows: 8, risk: "low" });
    expect(p.result.path).toHaveLength(8);
    const w = await playInstant(u.id, "wheel", 100, { risk: "med", segments: 20 });
    expect(typeof w.result.index).toBe("number");
  });
});

describe("세션형 게임", () => {
  it("mines: hides the board, pays on cashout and reveals the board at the end", async () => {
    const u = await createUser();
    const s = await startSession(u.id, "mines", 100, { mines: 3 });
    expect(JSON.stringify(s)).not.toContain("board");
    const [{ secret }] = await db`select secret from private.solo_secrets where bet_id = ${s.betId}`;
    const safe = [...Array(25).keys()].filter((t) => !secret.board.includes(t));
    await stepSession(u.id, "mines", { tile: safe[0] });
    const step2 = await stepSession(u.id, "mines", { tile: safe[1] });
    expect(step2.state).toMatchObject({ revealed: [safe[0], safe[1]] });
    const got = await cashoutSession(u.id, "mines");
    expect(got.status).toBe("won");
    expect(got.payout).toBe(Math.floor((100 * (got.state as { mult100: number }).mult100) / 100));
    expect((got.state as { board: number[] }).board).toEqual(secret.board);
    expect(await balance(u.id)).toBe(10000 - 100 + got.payout!);
  });

  it("mines: stepping on a mine loses and blocks further steps", async () => {
    const u = await createUser();
    const s = await startSession(u.id, "mines", 100, { mines: 24 });
    const [{ secret }] = await db`select secret from private.solo_secrets where bet_id = ${s.betId}`;
    const r = await stepSession(u.id, "mines", { tile: secret.board[0] });
    expect(r.status).toBe("lost");
    await expect(stepSession(u.id, "mines", { tile: 0 })).rejects.toThrow(/없어요/);
    expect(await balance(u.id)).toBe(9900);
  });

  it("chicken: crosses the first lane on start", async () => {
    const u = await createUser();
    const s = await startSession(u.id, "chicken", 100, { difficulty: "easy" });
    const [{ secret }] = await db`select secret from private.solo_secrets where bet_id = ${s.betId}`;
    if (secret.deathLane === 1) {
      expect(s.status).toBe("lost");
    } else {
      expect((s.state as { crossed: number }).crossed).toBe(1);
      const got = await cashoutSession(u.id, "chicken");
      expect(got.payout).toBe(107);
    }
  });

  it("hilo: needs one correct guess before cashing out", async () => {
    const u = await createUser();
    const s = await startSession(u.id, "hilo", 100, {});
    await expect(cashoutSession(u.id, "hilo")).rejects.toThrow(/한 번 이상/);
    const [{ secret }] = await db`select secret from private.solo_secrets where bet_id = ${s.betId}`;
    const cur = secret.cards[0].rank;
    const next = secret.cards[1].rank;
    const guess = cur === 1 ? (next > 1 ? "hi" : "same") : cur === 13 ? (next < 13 ? "lo" : "same") : next >= cur ? "hi" : "lo";
    const r = await stepSession(u.id, "hilo", { guess });
    expect(r.status).toBe("active");
    const got = await cashoutSession(u.id, "hilo");
    expect(got.payout).toBeGreaterThan(0);
    expect(JSON.stringify(await getSession(u.id, "hilo"))).not.toContain("cards");
  });

  it("refuses to rotate the seed while a session is active", async () => {
    const u = await createUser();
    await startSession(u.id, "mines", 100, { mines: 1 });
    await expect(rotateSeed(u.id)).rejects.toThrow(/끝낸 뒤/);
    await expect(startSession(u.id, "mines", 100, { mines: 1 })).rejects.toThrow(/진행 중/);
  });
});

describe("평가 반영: 끝까지 가는 판", () => {
  it("mines: finding every gem pays out (24 mines → first gem wins)", async () => {
    const u = await createUser();
    const s = await startSession(u.id, "mines", 100, { mines: 24 });
    const [{ secret }] = await db`select secret from private.solo_secrets where bet_id = ${s.betId}`;
    const gem = [...Array(25).keys()].find((t) => !secret.board.includes(t))!;
    const r = await stepSession(u.id, "mines", { tile: gem });
    expect(r.status).toBe("won");
    expect(r.payout).toBe(Math.floor((100 * 2475) / 100)); // 0.99 × 25 = 24.75×
  });

  it("mines: clearing all 22 gems with 3 mines auto cashes out", async () => {
    const u = await createUser();
    const s = await startSession(u.id, "mines", 10, { mines: 3 });
    const [{ secret }] = await db`select secret from private.solo_secrets where bet_id = ${s.betId}`;
    const gems = [...Array(25).keys()].filter((t) => !secret.board.includes(t));
    let r;
    for (const g of gems) r = await stepSession(u.id, "mines", { tile: g });
    expect(r!.status).toBe("won");
    expect(r!.payout).toBeGreaterThan(10);
  });

  it("hilo: running out of cards ends the round instead of locking it", async () => {
    const u = await createUser();
    const s = await startSession(u.id, "hilo", 100, {});
    await db`update public.solo_bets set state = jsonb_set(state, '{index}', '199') where id = ${s.betId}`;
    const r = await stepSession(u.id, "hilo", { guess: "skip" });
    expect(r.status).toBe("won");
    expect(r.payout).toBe(100); // 맞힌 게 없으면 베팅액 그대로
    await expect(rotateSeed(u.id)).resolves.toBeTruthy();
  });

  it("rejects prototype keys as chicken difficulty with a 400-type error", async () => {
    const u = await createUser();
    await expect(startSession(u.id, "chicken", 100, { difficulty: "__proto__" })).rejects.toThrow(/난이도/);
    await expect(playInstant(u.id, "dice", 2_000_000, { mode: "under", target: 50 })).rejects.toThrow(/최대/);
  });

  it("every finished bet verifies against the revealed seed", async () => {
    const u = await createUser();
    await playInstant(u.id, "dice", 100, { mode: "over", target: 30 });
    await playInstant(u.id, "limbo", 100, { target100: 150 });
    await playInstant(u.id, "wheel", 100, { risk: "high", segments: 10 });
    await playInstant(u.id, "plinko", 100, { rows: 12, risk: "med" });
    const m = await startSession(u.id, "mines", 100, { mines: 5 });
    const [{ secret }] = await db`select secret from private.solo_secrets where bet_id = ${m.betId}`;
    await stepSession(u.id, "mines", { tile: secret.board[0] }); // 지뢰 밟기
    const c = await startSession(u.id, "chicken", 100, { difficulty: "hell" });
    if (c.status === "active") await cashoutSession(u.id, "chicken");
    const h = await startSession(u.id, "hilo", 100, {});
    await stepSession(u.id, "hilo", { guess: "skip" });
    const [{ secret: hs }] = await db`select secret from private.solo_secrets where bet_id = ${h.betId}`;
    const cur = hs.cards[1].rank;
    const guess = cur === 1 ? "same" : cur === 13 ? "same" : "hi";
    const g = await stepSession(u.id, "hilo", { guess });
    if (g.status === "active") await cashoutSession(u.id, "hilo");

    const fair = await getFairness(u.id);
    const { revealedServerSeed } = await rotateSeed(u.id);
    const { verifySoloBet } = await import("../lib/engine/solo/verify");
    const bets = await db`select game, nonce::int, stake::int, payout::int, params, state, status
                          from public.solo_bets where user_id = ${u.id} order by nonce`;
    expect(bets).toHaveLength(7);
    for (const b of bets) {
      const ok = verifySoloBet(b as never, { serverSeed: revealedServerSeed, clientSeed: fair.current.clientSeed, userId: u.id });
      expect([b.game, ok]).toEqual([b.game, true]);
    }
    // 기록을 조작하면 불일치
    const forged = { ...bets[0], payout: bets[0].payout + 1 };
    expect(verifySoloBet(forged as never, { serverSeed: revealedServerSeed, clientSeed: fair.current.clientSeed, userId: u.id })).toBe(false);
  });
});

describe("Crash", () => {
  async function freshRound() {
    // 진행 중인 라운드를 끝내고 새 라운드가 열리게 한다
    await db`update public.crash_rounds set betting_ends_at = now() - interval '1 hour' where status = 'running'`;
    await db`update private.crash_secrets set crash_ms = 0`;
    await db`update public.crash_rounds set crashed_at = now() - interval '1 hour' where status = 'crashed'`;
    const u = await createUser();
    await crashState(u.id); // 정산
    await db`update public.crash_rounds set crashed_at = now() - interval '1 hour' where status = 'crashed'`;
    return crashState(u.id); // 새 라운드
  }

  it("hides the crash point until the round crashes", async () => {
    const v = await freshRound();
    expect(v.round.phase).toBe("betting");
    expect(v.round.crashPoint100).toBeNull();
    expect(v.round.seed).toBeNull();
  });

  it("pays a manual cashout at the current multiplier and an auto cashout at its target", async () => {
    const v = await freshRound();
    const a = await createUser();
    const b = await createUser();
    await db`update public.crash_rounds set betting_ends_at = now() + interval '1 minute' where id = ${v.round.id}`;
    await crashBet(a.id, 100, null);
    await crashBet(b.id, 100, 101);
    await expect(crashBet(a.id, 100, null)).rejects.toThrow(/이미/);
    // 베팅 마감 3초 전으로 옮기고, 터지는 배율을 크게 해서 아직 안 터진 상태로 만든다
    await db`update public.crash_rounds set betting_ends_at = now() - interval '3 seconds' where id = ${v.round.id}`;
    await db`update private.crash_secrets set crash_point100 = 100000, crash_ms = 999999 where round_id = ${v.round.id}`;
    const out = await crashCashout(a.id);
    const mine = out.bets.find((x) => x.userId === a.id)!;
    expect(mine.cashout100).toBeGreaterThanOrEqual(155);
    expect(mine.payout).toBe(mine.cashout100);
    await expect(crashCashout(a.id)).rejects.toThrow(/없어요/);
    // 이제 터뜨린다: b의 자동 1.01×는 지급
    await db`update private.crash_secrets set crash_ms = 0 where round_id = ${v.round.id}`;
    await db`update public.crash_rounds set betting_ends_at = now() where id = ${v.round.id}`;
    const after = await crashState(a.id);
    expect(after.round.id).toBe(v.round.id);
    expect(after.round.phase).toBe("crashed");
    expect(after.round.seed).not.toBeNull();
    expect(commitOf(after.round.seed!)).toBe(after.round.commit);
    expect(after.bets.find((x) => x.userId === b.id)!.payout).toBe(101);
    expect(await balance(b.id)).toBe(10001);
    expect(await balance(a.id)).toBe(10000 - 100 + mine.payout!);
  });

  it("hides other players' bets from the API until the round crashes, and rounds verify", async () => {
    const v = await freshRound();
    await db`update public.crash_rounds set betting_ends_at = now() + interval '1 minute' where id = ${v.round.id}`;
    const a = await createUser();
    const b = await createUser();
    await crashBet(a.id, 100, 500);
    const { data: seen } = await b.client.from("crash_bets").select("user_id, auto100").eq("round_id", v.round.id);
    expect(seen).toEqual([]);
    const { data: own } = await a.client.from("crash_bets").select("auto100").eq("round_id", v.round.id);
    expect(own).toEqual([{ auto100: 500 }]);
    // 이 라운드를 터뜨린다 (터지는 시각만 당기고 배율은 그대로)
    await db`update public.crash_rounds set betting_ends_at = now() - interval '1 second' where id = ${v.round.id}`;
    await db`update private.crash_secrets set crash_ms = 0 where round_id = ${v.round.id}`;
    await crashState(a.id);
    const { data: after } = await b.client.from("crash_bets").select("auto100").eq("round_id", v.round.id);
    expect(after).toEqual([{ auto100: 500 }]);
    const { verifyCrashRound } = await import("../lib/engine/solo/verify");
    const [r] = await db`select commit_hash, seed, crash_point100 from public.crash_rounds where id = ${v.round.id}`;
    expect(verifyCrashRound({ commit: r.commit_hash, seed: r.seed, crashPoint100: r.crash_point100 })).toBe(true);
    // 배율을 바꿔 치면 검증에 걸린다
    expect(verifyCrashRound({ commit: r.commit_hash, seed: r.seed, crashPoint100: r.crash_point100 + 1 })).toBe(false);
  });

  it("rejects bets after betting closes", async () => {
    const v = await freshRound();
    await db`update public.crash_rounds set betting_ends_at = now() - interval '1 second' where id = ${v.round.id}`;
    await db`update private.crash_secrets set crash_ms = 999999 where round_id = ${v.round.id}`;
    const u = await createUser();
    await expect(crashBet(u.id, 100, null)).rejects.toThrow(/베팅 시간/);
    expect(await balance(u.id)).toBe(10000);
  });
});
