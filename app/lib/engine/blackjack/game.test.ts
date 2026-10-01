import { describe, expect, it } from "vitest";
import { replay } from "../replay";
import {
  blackjackDeck,
  createBlackjackHand,
  legalBlackjack,
  reduceBlackjack,
  viewBlackjack,
  type BlackjackAction,
  type BlackjackState,
  type BjMove,
  type CreateBlackjackHand,
} from "./game";
import { SHOE_SIZE, handTotal } from "./hands";

// 무늬(0~3)·숫자(2~14, 14 = A)로 카드 id. 같은 카드가 또 필요하면 deck번호(0~5)를 준다.
const c = (rank: number, suit = 0, deckNo = 0) => deckNo * 52 + suit * 13 + (rank - 2);
const A = 14,
  K = 13,
  Q = 12;

function params(n: number, stack = 1000): CreateBlackjackHand {
  const seats = Array.from({ length: n }, (_, i) => ({ id: `p${i}`, seatNo: i, stack }));
  return {
    handId: "bj-1",
    baseBet: 10,
    seats,
    serverSeed: "ab".repeat(32),
    seeds: seats.map((s, i) => ({ userId: s.id, clientSeed: (i + 1).toString(16).padStart(2, "0").repeat(16) })),
  };
}

/** 딜 순서: 좌석 1장씩 → 딜러 오픈 → 좌석 1장씩 → 딜러 히든 → 이후 받는 순서 */
function deck(front: number[]): number[] {
  if (new Set(front).size !== front.length) throw new Error("duplicate card in test deck");
  return [...front, ...Array.from({ length: SHOE_SIZE }, (_, i) => i).filter((x) => !front.includes(x))];
}

function start(front: number[], n = 1, bets: number[] = Array(n).fill(10), stack = 1000): BlackjackState {
  let s = createBlackjackHand(params(n, stack), deck(front));
  bets.forEach((amount, i) => (s = reduceBlackjack(s, { type: "bet", seatId: `p${i}`, amount })));
  return s;
}

const mv = (s: BlackjackState, m: BjMove) => reduceBlackjack(s, { type: "move", seatId: s.toAct!.seatId, move: m });
const seat = (s: BlackjackState, id = "p0") => s.seats.find((x) => x.id === id)!;

describe("점수", () => {
  it("counts aces as 11 when it fits (soft) and J/Q/K as 10", () => {
    expect(handTotal([c(A), c(6)])).toEqual({ total: 17, soft: true });
    expect(handTotal([c(A), c(6), c(K)])).toEqual({ total: 17, soft: false });
    expect(handTotal([c(A), c(A, 1)])).toEqual({ total: 12, soft: true });
    expect(handTotal([c(K), c(Q)])).toEqual({ total: 20, soft: false });
  });
});

describe("베팅 단계", () => {
  it("rejects odd, too small, and over-stack bets", () => {
    const s = createBlackjackHand(params(1, 100), deck([]));
    for (const amount of [11, 8, 102, 10.5]) {
      expect(() => reduceBlackjack(s, { type: "bet", seatId: "p0", amount })).toThrow();
    }
    expect(() => reduceBlackjack(s, { type: "bet", seatId: "p0", amount: 100 })).not.toThrow();
  });

  it("deals only after everyone decides; sit_out and bet_timeout mean no cards", () => {
    let s = createBlackjackHand(params(3), deck([c(10), c(9), c(5), c(7)]));
    s = reduceBlackjack(s, { type: "bet", seatId: "p0", amount: 10 });
    expect(s.phase).toBe("bet");
    s = reduceBlackjack(s, { type: "sit_out", seatId: "p1" });
    s = reduceBlackjack(s, { type: "bet_timeout" });
    expect(s.phase).toBe("play");
    expect(seat(s, "p1").hands).toEqual([]);
    expect(seat(s, "p2").status).toBe("out");
    expect(seat(s).hands[0].cards).toEqual([c(10), c(5)]);
  });

  it("ends with zero deltas when nobody bets", () => {
    let s = createBlackjackHand(params(2), deck([]));
    s = reduceBlackjack(s, { type: "bet_timeout" });
    expect(s.phase).toBe("done");
    expect(s.result!.deltas).toEqual({ p0: 0, p1: 0 });
    expect(s.dealer.cards).toEqual([]);
  });
});

describe("peek", () => {
  it("dealer blackjack (A up) settles at once: naturals push, others lose only the original bet", () => {
    // p0 10·9, p1 A·K, 딜러 A(오픈)·K(히든)
    const s = start([c(10), c(A, 1), c(A), c(9), c(K, 1), c(K)], 2);
    expect(s.phase).toBe("done");
    expect(s.result!.deltas).toEqual({ p0: -10, p1: 0 });
    expect(seat(s, "p1").hands[0].outcome).toBe("push");
  });

  it("ace up without dealer blackjack keeps playing", () => {
    const s = start([c(10), c(A), c(9), c(7)]);
    expect(s.phase).toBe("play");
    expect(s.dealer).toEqual({ cards: [c(A)], holeHidden: true });
  });

  it("dealer blackjack with a 10 up", () => {
    const s = start([c(10), c(K), c(9), c(A)]);
    expect(s.phase).toBe("done");
    expect(s.result!.deltas.p0).toBe(-10);
  });

  it("no dealer blackjack: play continues and the hole stays hidden", () => {
    const s = start([c(10), c(K), c(9), c(7)]);
    expect(s.phase).toBe("play");
    const v = viewBlackjack(s);
    expect(v.dealer).toEqual({ cards: [c(K)], holeHidden: true });
    expect("secrets" in v).toBe(false);
    expect(JSON.stringify(v)).not.toContain('"deck"');
  });

  it("player blackjack pays 3:2 without a turn; dealer does not draw for naturals only", () => {
    // p0 A·K, 딜러 6·5 (11)
    const s = start([c(A), c(6), c(K), c(5)], 1, [20]);
    expect(s.phase).toBe("done");
    expect(seat(s).hands[0].outcome).toBe("blackjack");
    expect(s.result!.deltas.p0).toBe(30);
    expect(s.dealer.cards).toEqual([c(6), c(5)]);
  });
});

describe("턴과 딜러", () => {
  it("dealer stands on soft 17", () => {
    // p0 10·8 = 18, 딜러 6·A = 소프트 17
    let s = start([c(10), c(6), c(8), c(A)]);
    s = mv(s, "stand");
    expect(s.dealer.cards).toEqual([c(6), c(A)]);
    expect(s.result!.dealerTotal).toBe(17);
    expect(s.result!.deltas.p0).toBe(10);
  });

  it("dealer draws to 17 on hard 16 and can bust", () => {
    // p0 10·8, 딜러 10·6 → 다음 카드 K로 버스트
    let s = start([c(10), c(10, 1), c(8), c(6), c(K)]);
    s = mv(s, "stand");
    expect(s.dealer.cards).toEqual([c(10, 1), c(6), c(K)]);
    expect(seat(s).hands[0].outcome).toBe("win");
  });

  it("everyone busts → dealer only reveals", () => {
    // p0 10·6 히트 K → 버스트, 딜러 5·10
    let s = start([c(10), c(5), c(6), c(10, 1), c(K)]);
    s = mv(s, "hit");
    expect(s.phase).toBe("done");
    expect(seat(s).hands[0].outcome).toBe("bust");
    expect(s.dealer.cards).toEqual([c(5), c(10, 1)]);
    expect(s.result!.deltas.p0).toBe(-10);
  });

  it("one bust and one natural → dealer only reveals", () => {
    // p0 10·6 히트 K → 버스트, p1 A·K, 딜러 5·10
    let s = start([c(10), c(A), c(5), c(6), c(K), c(10, 1), c(K, 1)], 2);
    s = mv(s, "hit");
    expect(s.phase).toBe("done");
    expect(s.dealer.cards).toEqual([c(5), c(10, 1)]);
    expect(s.result!.deltas).toEqual({ p0: -10, p1: 15 });
  });

  it("goes in seat order and timeout stands", () => {
    // p0 10·7, p1 9·8, 딜러 9·9 (18)
    let s = start([c(10), c(9), c(9, 1), c(7), c(8), c(9, 2)], 2);
    expect(s.toAct).toEqual({ seatId: "p0", handIdx: 0 });
    s = reduceBlackjack(s, { type: "timeout", seatId: "p0" });
    expect(s.toAct).toEqual({ seatId: "p1", handIdx: 0 });
    expect(() => reduceBlackjack(s, { type: "move", seatId: "p0", move: "hit" })).toThrow();
    s = mv(s, "stand");
    expect(s.result!.deltas).toEqual({ p0: -10, p1: -10 });
  });

  it("double takes exactly one card and doubles the bet", () => {
    // p0 6·5 = 11 더블 → 10 = 21, 딜러 10·7
    let s = start([c(6), c(10, 1), c(5), c(7), c(10)]);
    s = mv(s, "double");
    expect(seat(s).hands[0]).toMatchObject({ cards: [c(6), c(5), c(10)], bet: 20, doubled: true, outcome: "win" });
    expect(s.result!.deltas.p0).toBe(20);
    expect(seat(s).committed).toBe(20);
  });
});

describe("스플릿", () => {
  it("split aces get one card each, and A+10 after split is 21 paid 1:1", () => {
    // p0 A·A, 딜러 6·10 (16), 스플릿 → K, 9 / 딜러 2 받아 18
    let s = start([c(A), c(6), c(A, 1), c(10), c(K), c(9), c(2)]);
    expect(legalBlackjack(s, "p0")).toContain("split");
    s = mv(s, "split");
    expect(s.phase).toBe("done");
    expect(seat(s).hands.map((h) => [h.cards.length, h.outcome])).toEqual([
      [2, "win"],
      [2, "win"],
    ]);
    expect(s.result!.deltas.p0).toBe(20);
  });

  it("splits any two 10-value cards and allows double after split (DAS)", () => {
    // p0 K·Q, 딜러 6·10 → 손1 A (21, 자동 종료), 손2 2 → 더블 9 = 21, 딜러 10 받아 버스트
    let s = start([c(K), c(6), c(Q), c(10), c(A), c(2), c(9), c(10, 1)]);
    s = mv(s, "split");
    expect(s.toAct).toEqual({ seatId: "p0", handIdx: 1 });
    expect(seat(s).hands[0]).toMatchObject({ cards: [c(K), c(A)], done: true });
    expect(legalBlackjack(s, "p0")).toContain("double");
    expect(legalBlackjack(s, "p0")).not.toContain("split");
    s = mv(s, "double");
    expect(s.phase).toBe("done");
    expect(seat(s).hands.map((h) => h.outcome)).toEqual(["win", "win"]);
    expect(seat(s).committed).toBe(30); // 베팅 10 + 스플릿 10 + 더블 10
    expect(s.result!.deltas.p0).toBe(30);
  });

  it("needs cumulative stack for double and split", () => {
    // 스택 20, 베팅 20 → 남은 스택 0이라 더블·스플릿 불가
    let s = start([c(8), c(6), c(8, 1), c(10)], 1, [20], 20);
    expect(legalBlackjack(s, "p0")).toEqual(["hit", "stand"]);
    // 스택 40, 베팅 20 → 스플릿 가능, 스플릿 뒤에는 0이라 더블 불가
    s = start([c(8), c(6), c(8, 1), c(10), c(3), c(2)], 1, [20], 40);
    s = mv(s, "split");
    expect(seat(s).stack).toBe(0);
    expect(legalBlackjack(s, "p0")).toEqual(["hit", "stand"]);
    // 스택 30, 베팅 20 → 남은 10으로는 더블 불가
    s = start([c(6), c(9), c(5), c(7)], 1, [20], 30);
    expect(legalBlackjack(s, "p0")).toEqual(["hit", "stand"]);
  });

  it("splits only once, and the second hand gets its card only when its turn comes", () => {
    // p0 8·8, 딜러 6·10 → 스플릿, 손1이 8을 또 받아도 다시 스플릿 불가
    let s = start([c(8), c(6), c(8, 1), c(10), c(8, 2), c(3)]);
    s = mv(s, "split");
    expect(seat(s).hands.map((h) => h.cards)).toEqual([[c(8), c(8, 2)], [c(8, 1)]]);
    expect(legalBlackjack(s, "p0")).toEqual(["hit", "stand", "double"]);
    s = mv(s, "stand");
    expect(s.toAct).toEqual({ seatId: "p0", handIdx: 1 });
    expect(seat(s).hands[1].cards).toEqual([c(8, 1), c(3)]);
    expect(legalBlackjack(s, "p0")).not.toContain("split");
  });
});

describe("결정성·불변식", () => {
  /** 모든 시점: 덱·히든이 view에 없고, 진행 중 딜러 카드는 오픈 1장뿐 */
  function checkView(s: BlackjackState) {
    const v = viewBlackjack(s);
    const json = JSON.stringify(v);
    expect(json).not.toMatch(/"(secrets|deck|deckPos|hole)"/);
    if (s.phase === "play") {
      expect(v.dealer.cards).toHaveLength(1);
      expect(v.dealer.holeHidden).toBe(true);
      expect(v.dealer.cards).not.toContain(s.secrets.hole);
    }
  }

  /** 테스트용 정책: 가능한 수 중 하나를 결정적으로 고른다 */
  function play(seed: number): { initial: BlackjackState; log: BlackjackAction[]; final: BlackjackState } {
    const p = { ...params(3, 200), handId: `fz-${seed}`, serverSeed: (seed % 256).toString(16).padStart(2, "0").repeat(32) };
    const initial = createBlackjackHand(p, blackjackDeck(p));
    const log: BlackjackAction[] = [];
    let s = initial;
    const step = (a: BlackjackAction) => {
      log.push(a);
      s = reduceBlackjack(s, a);
      checkView(s);
    };
    let k = seed;
    const pick = <T>(xs: T[]) => xs[(k = (k * 1103515245 + 12345) >>> 0) % xs.length];
    for (const x of s.seats) {
      if (pick([0, 1, 2, 3]) === 0) step({ type: "sit_out", seatId: x.id });
      else step({ type: "bet", seatId: x.id, amount: pick([10, 20, 50, 100]) });
    }
    while (s.phase === "play") {
      const id = s.toAct!.seatId;
      step(pick([0, 1, 2, 3, 4]) === 0 ? { type: "timeout", seatId: id } : { type: "move", seatId: id, move: pick(legalBlackjack(s, id) as BjMove[]) });
    }
    return { initial, log, final: s };
  }

  it("replays to the same result and keeps money invariants over many random hands", () => {
    for (let seed = 1; seed <= 1500; seed++) {
      const { initial, log, final } = play(seed);
      expect(final.phase).toBe("done");
      expect(replay(initial, reduceBlackjack, log)).toEqual(final);
      const used = [...final.dealer.cards, ...final.seats.flatMap((x) => x.hands.flatMap((h) => h.cards))];
      expect(new Set(used).size).toBe(used.length);
      for (const x of final.seats) {
        const delta = final.result!.deltas[x.id];
        expect(x.committed).toBe(x.hands.reduce((a, h) => a + h.bet, 0));
        expect(x.stack).toBe(x.startStack + delta);
        expect(x.stack).toBeGreaterThanOrEqual(0);
        expect(delta).toBeGreaterThanOrEqual(-x.committed);
        expect(delta).toBeLessThanOrEqual(1.5 * x.committed);
      }
    }
  });
});
