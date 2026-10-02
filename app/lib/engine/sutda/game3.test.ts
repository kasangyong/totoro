import { describe, expect, it } from "vitest";
import { legalActions, type BetActionType } from "../betting";
import { replay } from "../replay";
import { autoPick, createSutdaHand, reduceSutda, viewSutda, type CreateSutdaHand, type SutdaAction, type SutdaState } from "./game";
import { evaluate } from "./hands";

// 3장 섯다 — sutda3-arch.md 결정 1·2
const S = (m: number) => (m - 1) * 2;
const N = (m: number) => (m - 1) * 2 + 1;

function params(n: number, stacks: number[] = Array(n).fill(1000)): CreateSutdaHand {
  const seats = Array.from({ length: n }, (_, i) => ({ id: `p${i}`, seatNo: i, stack: stacks[i] }));
  return {
    handId: "hand-3",
    variant: 3,
    baseBet: 10,
    bossId: "p0",
    seats,
    serverSeed: "cd".repeat(32),
    seeds: seats.map((s, i) => ({ userId: s.id, clientSeed: i.toString(16).padStart(2, "0").repeat(16) })),
  };
}

function deck(front: number[]): number[] {
  return [...front, ...Array.from({ length: 20 }, (_, i) => i).filter((c) => !front.includes(c))];
}

/** 딜 순서: 보스부터 1장째 한 바퀴 → 2장째 한 바퀴 → (1차 베팅 후) 3장째 한 바퀴 */
function create(n: number, front: number[], rematchFronts: number[][] = [], stacks?: number[]) {
  const decks = [deck(front), ...rematchFronts.map(deck)];
  while (decks.length < 4) decks.push(deck([]));
  return createSutdaHand(params(n, stacks), decks);
}

const mine = (s: SutdaState, id: string) => s.cards.filter((c) => c.ownerId === id).map((c) => c.card);
const open = (s: SutdaState, id: string, card: number) => reduceSutda(s, { type: "open", seatId: id, card });
const pick = (s: SutdaState, id: string, a: number, b: number) => reduceSutda(s, { type: "pick", seatId: id, cards: [a, b] });
const bet = (s: SutdaState, action: BetActionType) => reduceSutda(s, { type: "bet", seatId: s.round.toActId!, action });

function checkRound(state: SutdaState): SutdaState {
  let s = state;
  const phase = s.phase;
  while (s.phase === phase && s.round.toActId) {
    s = bet(s, legalActions(s.seats, s.round, s.round.toActId).includes("check") ? "check" : "call");
  }
  return s;
}

/** p0 1·2월 일반, p1 3·4월 일반, p2 5·6월 일반 / 3장째 p0 S(9), p1 S(10), p2 S(1) */
const BASIC = [N(1), N(3), N(5), N(2), N(4), N(6), S(9), S(10), S(1)];

describe("3장 섯다 진행", () => {
  it("deals two from the boss, keeps open choices secret, then reveals them together", () => {
    let s = create(3, BASIC);
    expect(s.phase).toBe("open");
    expect(mine(s, "p0")).toEqual([N(1), N(2)]);
    expect(mine(s, "p2")).toEqual([N(5), N(6)]);
    expect(s.round.toActId).toBeNull();

    s = open(s, "p0", N(2));
    const other = viewSutda(s, "p1");
    expect(other.chosen).toEqual(["p0"]);
    expect(other.cards.filter((c) => c.ownerId === "p0").every((c) => c.card === null)).toBe(true);
    expect(other.myOpen).toBeNull();
    expect(viewSutda(s, "p0").myOpen).toBe(N(2));
    expect(JSON.stringify(other)).not.toMatch(/opens|picks|decks/);

    s = open(s, "p1", N(3));
    s = open(s, "p2", N(6));
    expect(s.phase).toBe("bet1");
    expect(s.chosen).toEqual([]);
    expect(s.cards.filter((c) => c.faceUp).map((c) => c.card).sort((a, b) => a - b)).toEqual([N(2), N(3), N(6)].sort((a, b) => a - b));
    expect(s.round.toActId).toBe("p0");
  });

  it("deals the third card after the first bet, keeps picks secret during bet 2, and shows only the used pair", () => {
    let s = create(3, BASIC);
    s = open(open(open(s, "p0", N(1)), "p1", N(3)), "p2", N(5));
    s = checkRound(s);
    expect(s.phase).toBe("pick");
    expect(mine(s, "p0")).toEqual([N(1), N(2), S(9)]);
    // p0은 공개한 1월을 버리고 2·9 (1끗), p1 3·4 (7끗), p2 5·1광 (6끗)
    s = pick(s, "p0", N(2), S(9));
    s = pick(s, "p1", N(3), N(4));
    expect(viewSutda(s, "p0").myPick).toEqual([N(2), S(9)].sort((a, b) => a - b));
    s = pick(s, "p2", N(5), S(1));
    expect(s.phase).toBe("bet2");
    const v = viewSutda(s, "p1");
    expect(v.myPick).toEqual([N(3), N(4)]);
    expect(JSON.stringify(v)).not.toMatch(/picks/);
    expect(v.cards.filter((c) => c.ownerId === "p0" && c.card !== null).map((c) => c.card)).toEqual([N(1)]); // 공개한 카드만

    s = checkRound(s);
    expect(s.phase).toBe("done");
    expect(s.result!.winnerId).toBe("p1");
    expect(s.used).toEqual({ p0: [N(2), S(9)].sort((a, b) => a - b), p1: [N(3), N(4)], p2: [N(5), S(1)].sort((a, b) => a - b) });
    expect(s.result!.hands.p0.label).toBe("1끗");
    // 숨긴 채 버린 카드는 끝나도 남에게 보이지 않는다
    const end = viewSutda(s, "p1");
    expect(end.cards.find((c) => c.ownerId === "p2" && c.card === null)).toBeDefined();
    expect(end.cards.find((c) => c.ownerId === "p0" && c.card === N(1))!.faceUp).toBe(true);
  });

  it("ends without a pick when everyone else dies in the first bet", () => {
    let s = create(3, BASIC);
    s = open(open(open(s, "p0", N(1)), "p1", N(3)), "p2", N(5));
    s = bet(s, "ping");
    s = bet(s, "die");
    s = bet(s, "die");
    expect(s.phase).toBe("done");
    expect(s.cards).toHaveLength(6);
    expect(s.result!.payouts).toEqual({ p0: 40 });
  });

  it("lets all-in players pick and rejects bad choices", () => {
    // p0 스택 = 기본금 → 바로 올인
    let s = create(3, BASIC, [], [10, 1000, 1000]);
    expect(() => reduceSutda(s, { type: "bet", seatId: "p0", action: "check" })).toThrow(/choices/);
    expect(() => open(s, "p0", N(3))).toThrow(/not your card/);
    s = open(s, "p0", N(1));
    expect(() => open(s, "p0", N(2))).toThrow(/already/);
    expect(() => pick(s, "p1", N(3), N(4))).toThrow(/choices/);
    s = open(open(s, "p1", N(3)), "p2", N(5));
    expect(() => open(s, "p1", N(3))).toThrow(/no choice/);
    s = bet(s, "check"); // p1 (p0은 올인이라 건너뜀)
    s = bet(s, "die"); // p2
    expect(s.phase).toBe("pick");
    expect(() => pick(s, "p2", N(5), N(6))).toThrow(/not in this choice/);
    expect(() => pick(s, "p0", N(1), N(1))).toThrow(/bad pick/);
    expect(() => pick(s, "p0", N(1), N(3))).toThrow(/bad pick/);
    s = pick(s, "p0", N(1), N(2)); // 올인한 p0도 고른다
    s = pick(s, "p1", N(4), S(10));
    expect(s.phase).toBe("done"); // 2차 베팅은 p1 혼자라 바로 쇼다운
    expect(s.result!.hands.p0.label).toBe("알리"); // 1·2월
  });

  it("applies the timeout rules: lower month (normal first) to open, best ordinary value to pick", () => {
    // p0 3월 일반·1광, p1 4월 열끗·4월 일반 / 3장째 p0 7열끗, p1 10월 일반
    let s = create(2, [N(3), S(4), S(1), N(4), S(7), N(10)]);
    s = reduceSutda(s, { type: "choice_timeout" });
    expect(s.cards.filter((c) => c.faceUp).map((c) => c.card).sort((a, b) => a - b)).toEqual([S(1), N(4)].sort((a, b) => a - b));
    s = checkRound(s);
    s = reduceSutda(s, { type: "choice_timeout" });
    // p0: 3·1광(4끗) 1광·7열끗(8끗) 3·7열끗(땡잡이 아님: 3월 일반) → 1·7 / p1: 4·4 땡
    expect(s.phase).toBe("bet2");
    s = checkRound(s);
    expect(s.used).toEqual({ p0: [S(1), S(7)], p1: [S(4), N(4)] });
    expect(s.result!.hands.p1.label).toBe("4땡");
  });

  it("does not auto-pick 땡잡이 but a player can pick it to catch a 9땡", () => {
    // p0 3광·7열끗·10일반, p1 9열끗·9일반·2일반
    const front = [S(3), S(9), S(7), N(9), N(10), N(2)];
    let auto = create(2, front);
    auto = reduceSutda(auto, { type: "choice_timeout" });
    auto = checkRound(auto);
    auto = reduceSutda(auto, { type: "choice_timeout" });
    auto = checkRound(auto);
    expect(auto.used!.p0).toEqual([S(7), N(10)].sort((a, b) => a - b)); // 7끗 (평소 값 최고)
    expect(auto.result!.winnerId).toBe("p1");

    let s = create(2, front);
    s = open(open(s, "p0", S(3)), "p1", S(9));
    s = checkRound(s);
    s = pick(pick(s, "p0", S(3), S(7)), "p1", S(9), N(9));
    s = checkRound(s);
    expect(evaluate(S(3), S(7)).kind).toBe("땡잡이");
    expect(s.result!.winnerId).toBe("p0");
  });

  it("replays a 구사 rematch with rejoin through the whole 3-card flow and clears old choices", () => {
    // 1경기: p0 4·9(구사), p1 5·6(1끗), p2 2·3(5끗) → p2가 1차에서 다이, 구사 재경기 (p2 재참여 가능)
    const first = [N(4), N(5), N(2), N(9), N(6), N(3), N(1), N(7), N(8)];
    // 재경기: p0 장땡
    const second = [S(10), N(1), N(2), N(10), N(3), N(4), N(5), N(6), N(7)];
    let s = create(3, first, [second]);
    s = open(open(open(s, "p0", N(4)), "p1", N(5)), "p2", N(2));
    s = bet(s, "check");
    s = bet(s, "check");
    s = bet(s, "die"); // p2
    expect(s.phase).toBe("pick");
    s = pick(pick(s, "p0", N(4), N(9)), "p1", N(5), N(6));
    s = checkRound(s);
    expect(s.phase).toBe("rejoin");
    expect(s.rejoin!.candidates).toEqual(["p2"]);
    expect(viewSutda(s, "p0").myPick).toBeNull(); // 재참여 결정 중엔 지난 선택이 남지 않는다
    s = reduceSutda(s, { type: "rejoin", seatId: "p2", join: true });
    expect(s.rematchNo).toBe(1);
    expect(s.phase).toBe("open");
    expect(s.chosen).toEqual([]);
    expect(s.used).toBeUndefined();
    expect(s.history[0].used).toEqual({ p0: [N(4), N(9)].sort((a, b) => a - b), p1: [N(5), N(6)].sort((a, b) => a - b) });
    expect(mine(s, "p2")).toHaveLength(2);
    s = reduceSutda(s, { type: "choice_timeout" });
    s = checkRound(s);
    s = reduceSutda(s, { type: "choice_timeout" });
    s = checkRound(s);
    expect(s.phase).toBe("done");
    expect(s.result!.winnerId).toBe("p0");
  });

  // p0 2·3·6월 일반 → 갑오, p1 2광·7열끗·8일반 → 갑오 (특수 조합 없음), p2 5·6광·10광 → 6끗
  const TIE3 = [N(2), S(2), N(5), N(3), S(7), S(6), N(6), N(8), S(10)];
  const TIE2 = [N(2), S(2), N(3), S(7), N(6), N(8)];

  it(`splits after the rematch limit, replaying the 3-card flow each time`, () => {
    let s = create(2, TIE2, [TIE2, TIE2, TIE2]);
    for (let round = 0; round < 4; round++) {
      expect(s.phase).toBe("open");
      expect(s.rematchNo).toBe(round);
      s = reduceSutda(s, { type: "choice_timeout" });
      s = checkRound(s);
      s = reduceSutda(s, { type: "choice_timeout" });
      s = checkRound(s);
    }
    expect(s.phase).toBe("done");
    expect(s.result!.splitAfterMaxRematches).toBe(true);
    expect(s.result!.payouts).toEqual({ p0: 10, p1: 10 });
    expect(s.history).toHaveLength(3);
  });

  it("rejects choices from players left out of a rematch", () => {
    let s = create(3, TIE3);
    s = reduceSutda(s, { type: "choice_timeout" });
    s = checkRound(s);
    s = reduceSutda(s, { type: "choice_timeout" });
    s = checkRound(s);
    expect(s.rematchNo).toBe(1);
    expect(s.participants.sort()).toEqual(["p0", "p1"]);
    expect(s.phase).toBe("open");
    expect(() => open(s, "p2", mine(s, "p0")[0])).toThrow(/not in this choice/);
    expect(mine(s, "p2")).toEqual([]);
  });

  it("deals from the boss when the boss is not the first seat", () => {
    const p = params(3);
    p.bossId = "p1";
    const s = createSutdaHand(p, [deck([N(1), N(2), N(3), N(4), N(5), N(6)]), deck([]), deck([]), deck([])]);
    // 순서: p1, p2, p0, p1, p2, p0
    expect(mine(s, "p1")).toEqual([N(1), N(4)]);
    expect(mine(s, "p2")).toEqual([N(2), N(5)]);
    expect(mine(s, "p0")).toEqual([N(3), N(6)]);
  });

  it("auto-pick always takes a combo of the highest ordinary value (ties at the top cannot happen)", () => {
    for (let a = 0; a < 20; a++)
      for (let b = a + 1; b < 20; b++)
        for (let c = b + 1; c < 20; c++) {
          const combos: [number, number][] = [[a, b], [a, c], [b, c]];
          const values = combos.map(([x, y]) => evaluate(x, y).value);
          const top = Math.max(...values);
          expect(values.filter((v) => v === top)).toHaveLength(1);
          const [x, y] = autoPick([c, a, b]);
          expect(evaluate(x, y).value).toBe(top);
        }
  });

  it("continues a stored (JSON round-tripped) 2-card state exactly like the live one", () => {
    let live = createSutdaHand({ ...params(3), variant: undefined });
    live = bet(live, "ping");
    let stored = JSON.parse(JSON.stringify(live)) as SutdaState;
    const step = (s: SutdaState) => bet(s, legalActions(s.seats, s.round, s.round.toActId!).includes("check") ? "check" : "call");
    while (live.phase !== "done" && live.round.toActId) {
      live = step(live);
      stored = step(stored);
    }
    expect(live.phase).not.toBe("bet1");
    expect(JSON.parse(JSON.stringify(stored))).toEqual(JSON.parse(JSON.stringify(live)));
  });

  it("keeps the 2-card shape when no variant is given", () => {
    const s = createSutdaHand({ ...params(2), variant: undefined });
    expect(s.phase).toBe("bet1");
    expect("variant" in s).toBe(false);
    expect("chosen" in viewSutda(s, "p0")).toBe(false);
    expect(() => createSutdaHand({ ...params(2), variant: 4 as 3 })).toThrow(/variant/);
  });
});

describe("3장 섯다 퍼즈", () => {
  it("keeps chips constant, replays deterministically and never leaks others' choices", () => {
    let seed = 11;
    const rand = (n: number) => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed % n;
    };
    for (let h = 0; h < 400; h++) {
      const n = 2 + rand(5);
      const p = params(n, Array.from({ length: n }, () => 10 + rand(500)));
      p.handId = `fz3-${h}`;
      p.serverSeed = rand(1e9).toString(16).padStart(8, "0").repeat(8);
      const start = p.seats.reduce((a, x) => a + x.stack, 0);
      const initial = createSutdaHand(p);
      const log: SutdaAction[] = [];
      let s = initial;
      let steps = 0;
      while (s.phase !== "done") {
        const chips = s.seats.reduce((a, x) => a + x.stack + x.handContrib, 0) + s.carried.reduce((a, x) => a + x.amount, 0);
        expect(chips).toBe(start);
        let a: SutdaAction;
        if (s.phase === "open" || s.phase === "pick") {
          const live = s.seats.filter((x) => s.participants.includes(x.id) && !x.folded).map((x) => x.id);
          const todo = live.filter((id) => !s.chosen!.includes(id));
          // 남의 view에 아직 공개 안 된 선택이 없는지
          for (const id of live) {
            const v = viewSutda(s, id);
            expect(JSON.stringify(v)).not.toMatch(/"opens"|"picks"/);
            // 값 누설: 남의 뒷면 카드는 null, 내 선택은 secrets와 같다
            expect(v.cards.every((c) => c.ownerId === id || c.faceUp || c.card === null)).toBe(true);
            expect(v.myOpen).toBe(s.secrets.opens?.[id] ?? null);
            expect(v.myPick).toEqual(s.secrets.picks?.[id] ?? null);
          }
          if (rand(6) === 0) a = { type: "choice_timeout" };
          else {
            const id = todo[rand(todo.length)];
            const cs = mine(s, id);
            if (s.phase === "open") a = { type: "open", seatId: id, card: cs[rand(cs.length)] };
            else {
              const i = rand(3);
              const pair = [cs[i], cs[(i + 1 + rand(2)) % 3]] as [number, number];
              a = { type: "pick", seatId: id, cards: pair };
            }
          }
        } else if (s.phase === "rejoin") {
          const undecided = s.rejoin!.candidates.filter((id) => !s.rejoin!.decided.includes(id));
          a = { type: "rejoin", seatId: undecided[rand(undecided.length)], join: rand(2) === 0 };
        } else {
          const legal = legalActions(s.seats, s.round, s.round.toActId!);
          a = { type: "bet", seatId: s.round.toActId!, action: legal[rand(legal.length)] };
        }
        log.push(a);
        s = reduceSutda(s, a);
        expect(++steps).toBeLessThan(600);
      }
      expect(s.seats.reduce((a, x) => a + x.stack, 0)).toBe(start);
      expect(replay(initial, reduceSutda, log)).toEqual(s);
    }
  }, 120_000);
});

describe("2장 섯다 회귀 (고정 시드)", () => {
  // 3장 섯다를 넣기 전 엔진(커밋 bf0cb89)으로 계산한 지급액. 같은 생성기로 다시 돌려 같아야 한다.
  it("pays exactly what the pre-3-card engine paid", () => {
    let seed = 3;
    const rand = (n: number) => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed % n;
    };
    const payouts: string[] = [];
    for (let h = 0; h < 3; h++) {
      const n = 2 + rand(5);
      const seats = Array.from({ length: n }, (_, i) => ({ id: `p${i}`, seatNo: i, stack: 10 + rand(500) }));
      const p = {
        handId: `eq-${h}`,
        baseBet: 10,
        bossId: "p0",
        seats,
        serverSeed: rand(1e9).toString(16).padStart(8, "0").repeat(8),
        seeds: seats.map((s, i) => ({ userId: s.id, clientSeed: i.toString(16).padStart(2, "0").repeat(16) })),
      };
      let s = createSutdaHand(p);
      while (s.phase !== "done") {
        let a: SutdaAction;
        if (s.phase === "rejoin") {
          const u = s.rejoin!.candidates.filter((id) => !s.rejoin!.decided.includes(id));
          a = rand(5) === 0 ? { type: "rejoin_timeout" } : { type: "rejoin", seatId: u[rand(u.length)], join: rand(2) === 0 };
        } else {
          const legal = legalActions(s.seats, s.round, s.round.toActId!);
          a = rand(6) === 0 ? { type: "timeout", seatId: s.round.toActId! } : { type: "bet", seatId: s.round.toActId!, action: legal[rand(legal.length)] };
        }
        s = reduceSutda(s, a);
      }
      payouts.push(JSON.stringify(s.result!.payouts));
    }
    expect(payouts).toEqual(['{"p1":280}', '{"p3":400}', '{"p1":60}']);
  });
});
