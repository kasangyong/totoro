import { describe, expect, it } from "vitest";
import { replay } from "../replay";
import {
  createHoldemHand,
  holdemDeck,
  legalHoldem,
  raiseBounds,
  reduceHoldem,
  viewHoldem,
  type CreateHoldemHand,
  type HoldemAction,
  type HoldemMove,
  type HoldemState,
} from "./game";

const c = (rank: number, suit = 0) => suit * 13 + (rank - 2);
const A = 14,
  K = 13,
  Q = 12,
  J = 11,
  T = 10;

function params(stacks: number[], baseBet = 10, button = "p0"): CreateHoldemHand {
  const seats = stacks.map((stack, i) => ({ id: `p${i}`, seatNo: i, stack }));
  return {
    handId: "hd-1",
    baseBet,
    bossId: button,
    seats,
    serverSeed: "ef".repeat(32),
    seeds: seats.map((s, i) => ({ userId: s.id, clientSeed: (i + 1).toString(16).padStart(2, "0").repeat(16) })),
  };
}

function deck(front: number[]): number[] {
  if (new Set(front).size !== front.length) throw new Error("duplicate card in test deck");
  return [...front, ...Array.from({ length: 52 }, (_, i) => i).filter((x) => !front.includes(x))];
}

const start = (stacks: number[], front: number[] = [], baseBet = 10) => createHoldemHand(params(stacks, baseBet), deck(front));
const go = (s: HoldemState, action: HoldemMove, amount?: number) =>
  reduceHoldem(s, { type: "act", seatId: s.toActId!, action, ...(amount !== undefined ? { amount } : {}) });
const seat = (s: HoldemState, id: string) => s.seats.find((x) => x.id === id)!;
const holes = (s: HoldemState, id: string) => s.holes.filter((h) => h.ownerId === id).map((h) => h.card);
const chips = (s: HoldemState) => s.seats.reduce((a, x) => a + x.stack + x.handContrib, 0);

/** 상태를 얼려 두면 엔진이 입력을 바꿀 때 바로 TypeError가 난다 */
function deepFreeze<T>(o: T): T {
  if (o && typeof o === "object" && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const v of Object.values(o)) deepFreeze(v);
  }
  return o;
}

describe("홀덤 진행", () => {
  it("posts blinds, deals from the button's left, burns before each street and acts in order", () => {
    // 3명: 버튼 p0, SB p1, BB p2. 카드 순서 p1 p2 p0 p1 p2 p0 / 번 / 플랍 3 / 번 / 턴 / 번 / 리버
    const d = Array.from({ length: 14 }, (_, i) => i + 20);
    let s = start([1000, 1000, 1000], d);
    expect([s.buttonId, s.sbId, s.bbId]).toEqual(["p0", "p1", "p2"]);
    expect(holes(s, "p1")).toEqual([d[0], d[3]]);
    expect(holes(s, "p0")).toEqual([d[2], d[5]]);
    expect([seat(s, "p1").stack, seat(s, "p2").stack]).toEqual([995, 990]);
    expect(s.currentBet).toBe(10);
    expect(s.toActId).toBe("p0");
    s = go(go(s, "call"), "call");
    // BB 옵션: 체크나 레이즈
    expect(s.toActId).toBe("p2");
    expect(legalHoldem(s, "p2")).toEqual(["fold", "check", "raise", "allin"]);
    s = go(s, "check");
    expect(s.phase).toBe("flop");
    expect(s.board).toEqual([d[7], d[8], d[9]]);
    expect(s.toActId).toBe("p1"); // 버튼 왼쪽부터
    s = go(go(go(s, "check"), "check"), "check");
    expect(s.board).toEqual([d[7], d[8], d[9], d[11]]);
    s = go(go(go(s, "check"), "check"), "check");
    expect(s.board[4]).toBe(d[13]);
  });

  it("puts the button on the small blind heads-up, acting first preflop and last after", () => {
    const d = Array.from({ length: 9 }, (_, i) => i + 30);
    let s = start([1000, 1000], d);
    expect([s.sbId, s.bbId]).toEqual(["p0", "p1"]);
    expect(holes(s, "p1")).toEqual([d[0], d[2]]); // BB가 먼저 받고 버튼이 마지막
    expect(s.toActId).toBe("p0");
    s = go(go(s, "call"), "check");
    expect(s.phase).toBe("flop");
    expect(s.toActId).toBe("p1");
  });

  it("enforces minimum bets and raises, and an all-in at the maximum", () => {
    let s = start([1000, 1000, 1000]);
    s = go(go(go(s, "call"), "call"), "check");
    // 플랍 첫 벳 최소 = BB
    expect(raiseBounds(s, "p1")).toEqual({ min: 10, max: 990 });
    expect(() => go(s, "raise", 9)).toThrow(/raise amount/);
    expect(() => go(s, "raise", 991)).toThrow(/raise amount/);
    s = go(s, "raise", 10);
    expect(raiseBounds(s, "p2")!.min).toBe(20);
    expect(() => go(s, "raise", 15)).toThrow();
    s = go(s, "raise", 40); // 증가분 30 → 다음 최소 70
    expect(raiseBounds(s, "p0")!.min).toBe(70);
    s = go(s, "raise", 990);
    expect(seat(s, "p0").allIn).toBe(true);
  });

  it("treats a sub-BB opening all-in as a bet that keeps the minimum raise at BB", () => {
    // p1 스택 15: 프리플랍 콜 후 5 남음
    let s = start([1000, 15, 1000]);
    s = go(go(go(s, "call"), "call"), "check");
    expect(legalHoldem(s, "p1")).toEqual(["fold", "check", "allin"]);
    s = go(s, "allin");
    expect(s.currentBet).toBe(5);
    expect(s.minRaise).toBe(10);
    expect(raiseBounds(s, "p2")!.min).toBe(15);
  });

  it("does not reopen raising after a short all-in, even after two of them [우리 규칙]", () => {
    // 4명: 버튼 p0(45), SB p1(60), BB p2, UTG p3
    let s = createHoldemHand(params([45, 60, 1000, 1000]), deck([]));
    expect(s.toActId).toBe("p3");
    s = go(s, "raise", 30); // 완전한 레이즈 (증가 20)
    s = go(s, "allin"); // p0 45: 증가 15 < 20 → 짧은 올인
    expect(s.minRaise).toBe(20);
    s = go(s, "allin"); // p1 60: 또 짧은 올인 (합치면 30 ≥ 20이지만 다시 열지 않음)
    expect(s.currentBet).toBe(60);
    s = go(s, "call"); // p2는 아직 행동 전이라 무엇이든 가능했지만 콜
    expect(s.toActId).toBe("p3");
    expect(legalHoldem(s, "p3")).toEqual(["fold", "call"]);
    expect(() => go(s, "raise", 100)).toThrow(/illegal/);
    expect(() => go(s, "allin")).toThrow(/illegal/);
  });

  it("reopens raising after a full raise", () => {
    let s = start([1000, 1000, 1000]);
    s = go(s, "raise", 30); // p0
    s = go(s, "call"); // p1
    s = go(s, "raise", 60); // p2: 증가 30 ≥ 20
    expect(s.toActId).toBe("p0");
    expect(legalHoldem(s, "p0")).toContain("raise");
  });

  it("runs out the board when at most one player can still act", () => {
    let s = start([1000, 50, 50]);
    s = go(s, "call"); // p0 10
    s = go(s, "allin"); // p1 50 (완전한 레이즈)
    expect(legalHoldem(s, "p2")).toEqual(["fold", "call"]); // 스택 40 = 콜 금액 → 올인 콜
    s = go(s, "call");
    s = go(s, "call"); // p0
    expect(s.phase).toBe("done");
    expect(s.board).toHaveLength(5);
    expect(chips(s)).toBe(1100);
  });

  it("builds three side pots and returns the uncalled excess", () => {
    // 버튼 p0(AA, 20), SB p1(KK, 50), BB p2(QQ, 100), UTG p3(J3, 1000)
    const front = [
      c(K), c(Q), c(J, 1), c(A), c(K, 1), c(Q, 1), c(3, 3), c(A, 1),
      c(8, 2), c(2, 3), c(7, 1), c(9, 2), c(T, 2), c(4), c(5, 2), c(6, 3),
    ];
    let s = createHoldemHand(params([20, 50, 100, 1000]), deck(front));
    s = go(s, "allin"); // p3
    s = go(s, "call"); // p0 올인 콜
    s = go(s, "call"); // p1
    s = go(s, "call"); // p2
    expect(s.phase).toBe("done");
    expect(s.result!.payouts).toEqual({ p0: 80, p1: 90, p2: 100, p3: 900 });
    expect(s.result!.winnerId).toBe("p0");
    expect(s.result!.hands.p0.category).toBe("원페어");
  });

  it("splits a tie and gives the odd chip to the lowest seat", () => {
    // 기본금 3 (SB 1): 보드 A K Q J T 스트레이트, p0은 플랍에서 폴드 → p1·p2가 9를 나눔
    const front = [c(2), c(3), c(4), c(2, 1), c(3, 1), c(4, 1), c(5), c(A), c(K, 1), c(Q, 2), c(6), c(J, 3), c(7), c(T)];
    let s = start([100, 100, 100], front, 3);
    s = go(go(go(s, "call"), "call"), "check");
    s = go(go(s, "check"), "check");
    s = go(s, "fold"); // p0
    s = go(go(s, "check"), "check");
    s = go(go(s, "check"), "check");
    expect(s.result!.payouts).toEqual({ p1: 5, p2: 4 });
    expect(Object.keys(s.result!.hands).sort()).toEqual(["p1", "p2"]);
  });

  it("ends without showing cards when everyone else folds, and times out to check or fold", () => {
    let s = start([1000, 1000, 1000]);
    s = reduceHoldem(s, { type: "timeout", seatId: "p0" }); // 콜해야 하니 폴드
    expect(seat(s, "p0").folded).toBe(true);
    s = go(s, "call"); // p1
    s = reduceHoldem(s, { type: "timeout", seatId: "p2" }); // BB 체크 가능
    expect(s.phase).toBe("flop");
    s = go(s, "raise", 50);
    s = go(s, "fold");
    expect(s.phase).toBe("done");
    expect(s.result!.hands).toEqual({});
    expect(s.holes.every((h) => !h.faceUp)).toBe(true);
    expect(s.result!.payouts).toEqual({ p1: 70 });
    expect(() => reduceHoldem(s, { type: "act", seatId: "p1", action: "check" })).toThrow(/over/);
  });

  it("returns what no live player can match, even from a player who folded", () => {
    // BB 스택 4 (블라인드에서 올인), UTG·SB 폴드 → BB는 4씩만 받고 SB의 남은 1은 돌려받는다
    let s = start([1000, 1000, 4]);
    expect(seat(s, "p2").allIn).toBe(true);
    s = go(s, "fold"); // p0
    s = go(s, "fold"); // p1
    expect(s.phase).toBe("done");
    expect(s.result!.payouts).toEqual({ p2: 8, p1: 1 });
    expect(chips(s)).toBe(2004);
  });

  it("rejects actions out of turn", () => {
    const s = start([1000, 1000, 1000]);
    expect(() => reduceHoldem(s, { type: "act", seatId: "p1", action: "call" })).toThrow(/turn/);
  });
});

describe("홀덤 퍼즈", () => {
  it("is deterministic, conserves chips and never shows others' hole cards or the deck", () => {
    let seed = 5;
    const rand = (n: number) => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed % n;
    };
    for (let h = 0; h < 800; h++) {
      const n = 2 + rand(5);
      const p = params(Array.from({ length: n }, () => 10 + rand(400)), 2 + rand(20), `p${rand(n)}`);
      p.handId = `hz-${h}`;
      p.serverSeed = rand(1e9).toString(16).padStart(8, "0").repeat(8);
      const initial = createHoldemHand(p, holdemDeck(p));
      const total = chips(initial);
      const log: HoldemAction[] = [];
      let s = initial;
      let steps = 0;
      while (s.phase !== "done") {
        expect(chips(s)).toBe(total);
        for (const viewer of s.seats.map((x) => x.id)) {
          const v = viewHoldem(s, viewer);
          expect(v.holes.every((x) => x.ownerId === viewer || x.faceUp || x.card === null)).toBe(true);
          expect(JSON.stringify(v)).not.toMatch(/"(deck|deckPos|secrets)"/);
        }
        const id = s.toActId!;
        const actor = s.seats.find((x) => x.id === id)!;
        expect(actor.folded || actor.allIn).toBe(false);
        deepFreeze(s);
        const legal = legalHoldem(s, id);
        let a: HoldemAction;
        if (rand(8) === 0) a = { type: "timeout", seatId: id };
        else {
          const move = legal[rand(legal.length)];
          const b = raiseBounds(s, id);
          a = { type: "act", seatId: id, action: move, ...(move === "raise" && b ? { amount: b.min + rand(b.max - b.min + 1) } : {}) };
        }
        log.push(a);
        s = reduceHoldem(s, a);
        expect(++steps).toBeLessThan(400);
      }
      expect(s.seats.reduce((a2, x) => a2 + x.stack, 0)).toBe(total);
      if (Object.keys(s.result!.hands).length > 0) expect(s.board).toHaveLength(5);
      expect(replay(initial, reduceHoldem, log)).toEqual(s);
      const used = [...s.board, ...s.holes.map((x) => x.card)];
      expect(new Set(used).size).toBe(used.length);
    }
  }, 120_000);
});
