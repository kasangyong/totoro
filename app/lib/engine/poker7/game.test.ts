import { describe, expect, it } from "vitest";
import { legalActions, type BetActionType } from "../betting";
import { replay } from "../replay";
import { createPoker7Hand, poker7Deck, reducePoker7, viewPoker7, type CreatePoker7Hand, type Poker7Action, type Poker7State } from "./game";

const S = 0,
  D = 1,
  H = 2,
  C = 3;
const c = (suit: number, rank: number) => suit * 13 + (rank - 2);

function params(n: number, stack = 1000): CreatePoker7Hand {
  const seats = Array.from({ length: n }, (_, i) => ({ id: `p${i}`, seatNo: i, stack }));
  return {
    handId: "poker-1",
    baseBet: 10,
    seats,
    serverSeed: "cd".repeat(32),
    seeds: seats.map((s, i) => ({ userId: s.id, clientSeed: (i + 1).toString(16).padStart(2, "0").repeat(16) })),
  };
}

/** 딜 순서(좌석 순, 한 장씩 돌림)대로 앞쪽 카드를 지정한 덱 */
function deck(front: number[]): number[] {
  return [...front, ...Array.from({ length: 52 }, (_, i) => i).filter((x) => !front.includes(x))];
}

const bet = (s: Poker7State, action: BetActionType) => reducePoker7(s, { type: "bet", seatId: s.round.toActId!, action });

const total = (s: Poker7State) => s.seats.reduce((a, x) => a + x.stack + x.handContrib, 0);

describe("7포커 진행", () => {
  // p0: ♠A ♦A ♣2 ♥3 (4장) → 버림 ♣2, 오픈 ♠A / p1: ♠K ♦K ♣4 ♥5 → 버림 ♣4, 오픈 ♠K
  // 4구~7구: p0 ♥A ♣A ♦9 ♠7 (포카드 A) / p1 ♥K ♣K ♦8 ♠6 (포카드 K)
  const front = [
    c(S, 14), c(S, 13), c(D, 14), c(D, 13), c(C, 2), c(C, 4), c(H, 3), c(H, 5),
    c(H, 14), c(H, 13), c(C, 14), c(C, 13), c(D, 9), c(D, 8), c(S, 7), c(S, 6),
  ];

  it("deals 4 cards, keeps choices secret until all choose, then plays 4구 to 7구", () => {
    let s = createPoker7Hand(params(2), deck(front));
    expect(s.phase).toBe("choice");
    expect(s.cards.filter((x) => x.ownerId === "p0").map((x) => x.card)).toEqual([c(S, 14), c(D, 14), c(C, 2), c(H, 3)]);
    s = reducePoker7(s, { type: "choose", seatId: "p0", discard: c(C, 2), open: c(S, 14) });
    const v = viewPoker7(s, "p1");
    expect(v.chosen).toEqual(["p0"]);
    expect(JSON.stringify(v)).not.toContain("choices");
    expect(v.cards.filter((x) => x.ownerId === "p0").every((x) => x.card === null)).toBe(true);

    s = reducePoker7(s, { type: "choose", seatId: "p1", discard: c(C, 4), open: c(S, 13) });
    expect(s.phase).toBe("bet");
    expect(s.street).toBe(4);
    expect(s.cards.filter((x) => x.ownerId === "p0")).toHaveLength(4);
    // 보스 = 오픈 카드가 센 사람: p0 (♠A ♥A 원페어) vs p1 (♠K ♥K 원페어)
    expect(s.round.bossId).toBe("p0");
    for (const street of [4, 5, 6, 7]) {
      expect(s.street).toBe(street);
      s = checkThroughStreet(s);
    }
    expect(s.phase).toBe("done");
    const p0 = s.cards.filter((x) => x.ownerId === "p0");
    expect(p0).toHaveLength(7);
    expect(s.result!.hands.p0.category).toBe("포카드");
    expect(s.result!.payouts).toEqual({ p0: 20 });
    expect(s.seats.map((x) => x.stack)).toEqual([1010, 990]);
  });

  it("deals 7구 face down and reveals everything at showdown", () => {
    let s = createPoker7Hand(params(2), deck(front));
    s = reducePoker7(s, { type: "choose", seatId: "p0", discard: c(C, 2), open: c(S, 14) });
    s = reducePoker7(s, { type: "choose", seatId: "p1", discard: c(C, 4), open: c(S, 13) });
    for (let i = 0; i < 3; i++) s = checkThroughStreet(s); // 4구·5구·6구 베팅 끝 → 7구 딜
    expect(s.street).toBe(7);
    const hidden = s.cards.filter((x) => !x.faceUp);
    expect(hidden).toHaveLength(2 * 3); // 처음 받은 비공개 2장 + 히든 1장
    const v = viewPoker7(s, "p1");
    expect(v.cards.filter((x) => x.ownerId === "p0" && x.card !== null)).toHaveLength(4);
  });

  it("auto-chooses on timeout: discards the weakest card and opens the next weakest", () => {
    let s = createPoker7Hand(params(2), deck(front));
    s = reducePoker7(s, { type: "choose", seatId: "p0", discard: c(C, 2), open: c(S, 14) });
    s = reducePoker7(s, { type: "choice_timeout" });
    expect(s.phase).toBe("bet");
    const p1Open = s.cards.filter((x) => x.ownerId === "p1" && x.faceUp).map((x) => x.card);
    expect(p1Open).toContain(c(H, 5));
    expect(s.cards.some((x) => x.card === c(C, 4))).toBe(false);
  });

  it("ends without reveal when everyone else dies", () => {
    let s = createPoker7Hand(params(3), deck([]));
    s = reducePoker7(s, { type: "choice_timeout" });
    s = bet(s, "half");
    s = bet(s, "die");
    s = bet(s, "die");
    expect(s.phase).toBe("done");
    expect(s.result!.hands).toEqual({});
    expect(s.cards.filter((x) => x.faceUp)).toHaveLength(3 * 2); // 오픈 카드 + 4구만
  });

  it("rejects bad choices and out-of-turn actions", () => {
    const s = createPoker7Hand(params(2), deck(front));
    expect(() => reducePoker7(s, { type: "choose", seatId: "p0", discard: c(S, 13), open: c(S, 14) })).toThrow();
    expect(() => reducePoker7(s, { type: "choose", seatId: "p0", discard: c(S, 14), open: c(S, 14) })).toThrow();
    expect(() => reducePoker7(s, { type: "bet", seatId: "p0", action: "check" })).toThrow();
    const chosen = reducePoker7(s, { type: "choice_timeout" });
    const other = chosen.round.toActId === "p0" ? "p1" : "p0";
    expect(() => reducePoker7(chosen, { type: "bet", seatId: other, action: "check" })).toThrow();
  });

  it("uses the RNG spec deck and replays deterministically", () => {
    const p = params(4);
    const log: Poker7Action[] = [{ type: "choice_timeout" }];
    let s = reducePoker7(createPoker7Hand(p), log[0]);
    expect(new Set(poker7Deck(p)).size).toBe(52);
    while (s.phase !== "done") {
      const legal = legalActions(s.seats, s.round, s.round.toActId!);
      const a: Poker7Action = { type: "bet", seatId: s.round.toActId!, action: legal[log.length % legal.length] };
      log.push(a);
      s = reducePoker7(s, a);
    }
    expect(replay(createPoker7Hand(p), reducePoker7, log)).toEqual(s);
  });
});

function checkThroughStreet(s: Poker7State): Poker7State {
  const street = s.street;
  while (s.phase === "bet" && s.street === street) {
    const legal = legalActions(s.seats, s.round, s.round.toActId!);
    s = bet(s, legal.includes("check") ? "check" : "call");
  }
  return s;
}

describe("7포커 칩 보존 (fuzz)", () => {
  it("keeps total chips constant and never leaks hidden cards", () => {
    let seed = 3;
    const rand = (n: number) => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed % n;
    };
    for (let h = 0; h < 400; h++) {
      const n = 2 + rand(5);
      const p = params(n);
      p.handId = `fuzz-${h}`;
      p.seats = p.seats.map((x) => ({ ...x, stack: 10 + rand(800) }));
      p.serverSeed = rand(1e9).toString(16).padStart(8, "0").repeat(8);
      const start = p.seats.reduce((a, x) => a + x.stack, 0);
      let s = reducePoker7(createPoker7Hand(p), { type: "choice_timeout" });
      let steps = 0;
      while (s.phase !== "done") {
        expect(total(s)).toBe(start);
        const viewer = `p${rand(n)}`;
        const v = viewPoker7(s, viewer);
        for (const card of v.cards) if (card.card !== null) expect(card.faceUp || card.ownerId === viewer).toBe(true);
        const legal = legalActions(s.seats, s.round, s.round.toActId!);
        s = bet(s, legal[rand(legal.length)]);
        expect(++steps).toBeLessThan(300);
      }
      expect(s.seats.reduce((a, x) => a + x.stack, 0)).toBe(start);
    }
  }, 60_000);
});
