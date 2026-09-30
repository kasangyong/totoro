import { describe, expect, it } from "vitest";
import {
  MAX_RAISES_PER_SEAT,
  applyAction,
  awardPots,
  computePots,
  isRoundOver,
  legalActions,
  postAntes,
  potTotal,
  splitPot,
  startRound,
  type Seat,
} from "./betting";

function seat(id: string, seatNo: number, stack: number, extra: Partial<Seat> = {}): Seat {
  return { id, seatNo, stack, handContrib: 0, roundContrib: 0, folded: false, allIn: false, acted: false, ...extra };
}

const BASE = 10;

function table(stacks: number[]): Seat[] {
  return postAntes(
    stacks.map((s, i) => seat(`p${i}`, i, s)),
    BASE,
  );
}

describe("betting round", () => {
  it("ends when everyone checks", () => {
    let { seats, round } = startRound(table([100, 100, 100]), "p0");
    for (const id of ["p0", "p1", "p2"]) ({ seats, round } = applyAction(seats, round, id, "check", BASE));
    expect(isRoundOver(round)).toBe(true);
  });

  it("ends when boss pings and everyone calls (ping is not a raise)", () => {
    let { seats, round } = startRound(table([100, 100]), "p0");
    expect(legalActions(seats, round, "p0")).toContain("ping");
    ({ seats, round } = applyAction(seats, round, "p0", "ping", BASE));
    expect(round.raises).toEqual({});
    expect(legalActions(seats, round, "p1")).not.toContain("ping");
    ({ seats, round } = applyAction(seats, round, "p1", "call", BASE));
    expect(isRoundOver(round)).toBe(true);
    expect(potTotal(seats)).toBe(40);
  });

  it("only the boss may ping", () => {
    let { seats, round } = startRound(table([100, 100]), "p0");
    ({ seats, round } = applyAction(seats, round, "p0", "check", BASE));
    expect(legalActions(seats, round, "p1")).not.toContain("ping");
    expect(() => applyAction(seats, round, "p1", "ping", BASE)).toThrow();
  });

  it("computes ddadang as twice the current high and half from the pot after calling", () => {
    let { seats, round } = startRound(table([1000, 1000]), "p0");
    ({ seats, round } = applyAction(seats, round, "p0", "half", BASE));
    // pot 20, H 0 → 0 + floor(20 × 1/2) = 10
    expect(round.high).toBe(10);
    ({ seats, round } = applyAction(seats, round, "p1", "ddadang", BASE));
    expect(round.high).toBe(20);
    ({ seats, round } = applyAction(seats, round, "p0", "half", BASE));
    // pot 50, owed 10 → pot after call 60 → 20 + 30
    expect(round.high).toBe(50);
    expect(round.raises).toEqual({ p0: 2, p1: 1 });
  });

  it(`caps raises at ${MAX_RAISES_PER_SEAT} per seat per round`, () => {
    let { seats, round } = startRound(table([100000, 100000]), "p0");
    ({ seats, round } = applyAction(seats, round, "p0", "half", BASE));
    ({ seats, round } = applyAction(seats, round, "p1", "half", BASE));
    ({ seats, round } = applyAction(seats, round, "p0", "half", BASE));
    ({ seats, round } = applyAction(seats, round, "p1", "half", BASE));
    // 둘 다 2번씩 레이즈 → p0은 콜·다이만
    expect(legalActions(seats, round, "p0")).toEqual(["call", "die"]);
    ({ seats, round } = applyAction(seats, round, "p0", "call", BASE));
    expect(isRoundOver(round)).toBe(true);
    // 다음 라운드에는 다시 레이즈 가능
    ({ seats, round } = startRound(seats, "p0"));
    expect(legalActions(seats, round, "p0")).toContain("half");
  });

  it("counts raises per seat, so one player's cap does not stop others", () => {
    let { seats, round } = startRound(table([100000, 100000, 100000]), "p0");
    ({ seats, round } = applyAction(seats, round, "p0", "half", BASE));
    ({ seats, round } = applyAction(seats, round, "p1", "half", BASE));
    ({ seats, round } = applyAction(seats, round, "p2", "call", BASE));
    ({ seats, round } = applyAction(seats, round, "p0", "half", BASE));
    ({ seats, round } = applyAction(seats, round, "p1", "call", BASE));
    expect(round.raises).toEqual({ p0: 2, p1: 1 });
    expect(round.toActId).toBe("p2");
    expect(legalActions(seats, round, "p2")).toContain("half");
    ({ seats, round } = applyAction(seats, round, "p2", "half", BASE));
    expect(legalActions(seats, round, "p0")).toEqual(["call", "die"]);
  });

  it("gives the pot to the last player when others die", () => {
    let { seats, round } = startRound(table([100, 100, 100]), "p0");
    ({ seats, round } = applyAction(seats, round, "p0", "ping", BASE));
    ({ seats, round } = applyAction(seats, round, "p1", "die", BASE));
    ({ seats, round } = applyAction(seats, round, "p2", "die", BASE));
    expect(isRoundOver(round)).toBe(true);
    const pots = computePots(seats);
    expect(pots).toEqual([{ amount: 40, eligible: ["p0"] }]);
  });

  it("caps a short call as all-in", () => {
    let { seats, round } = startRound(table([1000, 60]), "p0");
    ({ seats, round } = applyAction(seats, round, "p0", "half", BASE)); // high 10
    ({ seats, round } = applyAction(seats, round, "p1", "half", BASE)); // high 30, p1 stack 20
    ({ seats, round } = applyAction(seats, round, "p0", "half", BASE)); // high 70
    ({ seats, round } = applyAction(seats, round, "p1", "call", BASE)); // owes 40, has 20
    const p1 = seats.find((s) => s.id === "p1")!;
    expect(p1.stack).toBe(0);
    expect(p1.allIn).toBe(true);
    expect(isRoundOver(round)).toBe(true);
  });

  it("skips a round when at most one player can still act and owes nothing", () => {
    const seats = [
      seat("a", 0, 0, { handContrib: 50, allIn: true }),
      seat("b", 1, 500, { handContrib: 50 }),
    ];
    const { round } = startRound(seats, "a");
    expect(isRoundOver(round)).toBe(true);
  });

  it("hands the boss role (and ping) to the next actor when the boss has folded", () => {
    const seats = table([100, 100, 100]).map((s) => (s.id === "p0" ? { ...s, folded: true } : s));
    const { round, seats: started } = startRound(seats, "p0");
    expect(round.bossId).toBe("p1");
    expect(legalActions(started, round, "p1")).toContain("ping");
  });

  it("does not allow raising when nobody else can respond", () => {
    let { seats, round } = startRound(table([100, 30]), "p0");
    ({ seats, round } = applyAction(seats, round, "p0", "ping", BASE));
    ({ seats, round } = applyAction(seats, round, "p1", "half", BASE)); // p1 all-in
    expect(seats.find((s) => s.id === "p1")!.allIn).toBe(true);
    expect(legalActions(seats, round, "p0")).toEqual(["call", "die"]);
  });

  it("makes everyone act again after a raise", () => {
    let { seats, round } = startRound(table([500, 500, 500]), "p0");
    ({ seats, round } = applyAction(seats, round, "p0", "ping", BASE));
    ({ seats, round } = applyAction(seats, round, "p1", "call", BASE));
    ({ seats, round } = applyAction(seats, round, "p2", "half", BASE));
    expect(seats.filter((s) => s.acted).map((s) => s.id)).toEqual(["p2"]);
    expect(round.toActId).toBe("p0");
  });

  it("does not mutate its inputs", () => {
    const start = startRound(table([100, 100]), "p0");
    const frozen = JSON.stringify(start);
    applyAction(start.seats, start.round, "p0", "half", BASE);
    expect(JSON.stringify(start)).toBe(frozen);
  });

  it("wraps turn order by seat number and skips folded players", () => {
    let { seats, round } = startRound(table([100, 100, 100]), "p1");
    expect(round.toActId).toBe("p1");
    ({ seats, round } = applyAction(seats, round, "p1", "ping", BASE));
    expect(round.toActId).toBe("p2");
    ({ seats, round } = applyAction(seats, round, "p2", "die", BASE));
    expect(round.toActId).toBe("p0");
  });
});

describe("pots", () => {
  it("builds side pots from different all-in levels", () => {
    const seats = [
      seat("a", 0, 0, { handContrib: 50, allIn: true }),
      seat("b", 1, 0, { handContrib: 100, allIn: true }),
      seat("c", 2, 0, { handContrib: 200 }),
    ];
    expect(computePots(seats)).toEqual([
      { amount: 150, eligible: ["a", "b", "c"] },
      { amount: 100, eligible: ["b", "c"] },
      { amount: 100, eligible: ["c"] },
    ]);
  });

  it("adds folded contributions to the right levels", () => {
    const seats = [
      seat("a", 0, 0, { handContrib: 50, allIn: true }),
      seat("b", 1, 0, { handContrib: 100, allIn: true }),
      seat("c", 2, 0, { handContrib: 200 }),
      seat("d", 3, 0, { handContrib: 250, folded: true }),
    ];
    const pots = computePots(seats);
    // 50×4, 50×3(b,c,d), (100+100) + d가 c보다 더 낸 50
    expect(pots.map((p) => p.amount)).toEqual([200, 150, 250]);
    expect(pots.reduce((s, p) => s + p.amount, 0)).toBe(600);
  });

  it("gives split remainders to the lowest seat number", () => {
    const seats = [seat("x", 3, 0), seat("y", 1, 0)];
    expect(Object.fromEntries(splitPot(101, ["x", "y"], seats))).toEqual({ y: 51, x: 50 });
  });

  it("awards each pot among its own eligible players", () => {
    const seats = [
      seat("a", 0, 0, { handContrib: 50, allIn: true }),
      seat("b", 1, 0, { handContrib: 100 }),
      seat("c", 2, 0, { handContrib: 100 }),
    ];
    expect(() => splitPot(100, ["zz"], seats)).toThrow();
    expect(() => awardPots([{ amount: 10, eligible: ["b"] }], seats, () => ["a"])).toThrow();
    const rank = { a: 3, b: 2, c: 1 } as Record<string, number>;
    const best = (ids: readonly string[]) => {
      const top = Math.max(...ids.map((i) => rank[i]));
      return ids.filter((i) => rank[i] === top);
    };
    expect(Object.fromEntries(awardPots(computePots(seats), seats, best))).toEqual({ a: 150, b: 100 });
  });
});

describe("conservation (fuzz)", () => {
  it("never creates or loses points and always terminates", () => {
    let seed = 12345;
    const rand = (n: number) => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed % n;
    };
    for (let hand = 0; hand < 2000; hand++) {
      const n = 2 + rand(5);
      const stacks = Array.from({ length: n }, () => 5 + rand(3000));
      let seats = table(stacks);
      const total = stacks.reduce((a, b) => a + b, 0);
      for (let r = 0; r < 4; r++) {
        const live = seats.filter((s) => !s.folded);
        if (live.length <= 1) break;
        let round;
        ({ seats, round } = startRound(seats, live[rand(live.length)].id));
        let steps = 0;
        while (!isRoundOver(round)) {
          const legal = legalActions(seats, round, round.toActId!);
          expect(legal.length).toBeGreaterThan(0);
          ({ seats, round } = applyAction(seats, round, round.toActId!, legal[rand(legal.length)], BASE));
          expect(++steps).toBeLessThan(200);
        }
        for (const s of seats) expect(s.stack).toBeGreaterThanOrEqual(0);
        expect(seats.reduce((a, s) => a + s.stack + s.handContrib, 0)).toBe(total);
      }
      const pots = computePots(seats);
      expect(pots.reduce((a, p) => a + p.amount, 0)).toBe(potTotal(seats));
      for (const p of pots) {
        for (const id of p.eligible) expect(seats.find((s) => s.id === id)!.folded).toBe(false);
      }
      // 각 좌석은 자기 기여 이하 구간의 팟에만 자격이 있다
      for (const s of seats.filter((x) => !x.folded)) {
        const eligibleSum = pots.filter((p) => p.eligible.includes(s.id)).length;
        expect(eligibleSum).toBeGreaterThan(0);
      }
      const payouts = awardPots(pots, seats, (ids) => [ids[0]]);
      expect([...payouts.values()].reduce((a, b) => a + b, 0)).toBe(potTotal(seats));
    }
  }, 60_000);
});
