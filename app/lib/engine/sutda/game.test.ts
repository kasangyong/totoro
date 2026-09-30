import { describe, expect, it } from "vitest";
import { replay } from "../replay";
import {
  MAX_REMATCHES,
  createSutdaHand,
  reduceSutda,
  sutdaDecks,
  viewSutda,
  type CreateSutdaHand,
  type SutdaAction,
  type SutdaState,
} from "./game";
import { legalActions, type BetActionType } from "../betting";

const S = (m: number) => (m - 1) * 2;
const N = (m: number) => (m - 1) * 2 + 1;

const SERVER = "ab".repeat(32);

function params(n: number, stacks = 1000): CreateSutdaHand {
  const seats = Array.from({ length: n }, (_, i) => ({ id: `p${i}`, seatNo: i, stack: stacks }));
  return {
    handId: "hand-1",
    baseBet: 10,
    bossId: "p0",
    seats,
    serverSeed: SERVER,
    seeds: seats.map((s, i) => ({ userId: s.id, clientSeed: i.toString(16).padStart(2, "0").repeat(16) })),
  };
}

/** 앞쪽 카드를 지정하고 나머지는 남은 카드로 채운 덱 */
function deck(front: number[]): number[] {
  return [...front, ...Array.from({ length: 20 }, (_, i) => i).filter((c) => !front.includes(c))];
}

function act(state: SutdaState, action: BetActionType) {
  return reduceSutda(state, { type: "bet", seatId: state.round.toActId!, action });
}

/** 체크(또는 콜)로 이번 (재)경기가 끝날 때까지 진행. 재경기가 시작되면 멈춘다. */
function checkThrough(state: SutdaState): SutdaState {
  let s = state;
  const rematchNo = s.rematchNo;
  while (s.phase !== "done" && s.round.toActId && s.rematchNo === rematchNo) {
    const legal = legalActions(s.seats, s.round, s.round.toActId);
    s = act(s, legal.includes("check") ? "check" : "call");
  }
  return s;
}

/** 무작위 진행용: 베팅 차례면 가능한 액션 중 하나, 재경기 참여 대기면 후보 한 명의 참여/불참 */
function pickAction(s: SutdaState, pick: (n: number) => number): SutdaAction {
  if (s.phase === "rejoin") {
    const undecided = s.rejoin!.candidates.filter((id) => !s.rejoin!.decided.includes(id));
    return { type: "rejoin", seatId: undecided[pick(undecided.length)], join: pick(2) === 0 };
  }
  const legal = legalActions(s.seats, s.round, s.round.toActId!);
  return { type: "bet", seatId: s.round.toActId!, action: legal[pick(legal.length)] };
}

const totalChips =(s: SutdaState) => s.seats.reduce((a, x) => a + x.stack + x.handContrib, 0) +
  s.carried.reduce((a, p) => a + p.amount, 0);

describe("sutda hand flow", () => {
  it("deals one card, bets, deals a second, bets, and pays the best hand", () => {
    // 딜 순서: 보스 p0부터. 1장째 [p0, p1], 2장째 [p0, p1]
    const decks = [deck([S(10), N(1), N(10), N(2)])]; // p0 장땡, p1 알리
    let s = createSutdaHand(params(2), [...decks, deck([]), deck([]), deck([])]);
    expect(s.phase).toBe("bet1");
    expect(s.cards).toHaveLength(2);
    s = act(s, "check");
    s = act(s, "check");
    expect(s.phase).toBe("bet2");
    expect(s.cards).toHaveLength(4);
    s = checkThrough(s);
    expect(s.phase).toBe("done");
    expect(s.result!.winnerId).toBe("p0");
    expect(s.result!.payouts).toEqual({ p0: 20 });
    expect(s.seats.map((x) => x.stack)).toEqual([1010, 990]);
    expect(s.result!.hands.p0.label).toBe("장땡");
  });

  it("ends without showdown when everyone else dies", () => {
    let s = createSutdaHand(params(3));
    s = act(s, "ping");
    s = act(s, "die");
    s = act(s, "die");
    expect(s.phase).toBe("done");
    expect(s.result!.payouts).toEqual({ p0: 40 });
    expect(s.cards.every((c) => !c.faceUp)).toBe(true);
    expect(s.result!.hands).toEqual({});
  });

  it("hides other players' cards until showdown", () => {
    const s = createSutdaHand(params(3));
    const v1 = viewSutda(s, "p1");
    expect(v1.cards.filter((c) => c.card !== null).map((c) => c.ownerId)).toEqual(["p1"]);
    expect(viewSutda(s, null).cards.every((c) => c.card === null)).toBe(true);
    expect(JSON.stringify(v1)).not.toContain("decks");
  });

  it("rematches a tie among the tied players with a fresh deck and carries the pot", () => {
    const tie = deck([S(2), S(6), N(3), N(9)]); // p0 5끗, p1 5끗
    const p0wins = deck([S(10), N(1), N(10), N(2)]);
    let s = createSutdaHand(params(2), [tie, p0wins, deck([]), deck([])]);
    s = act(s, "ping"); // 팟 30
    s = act(s, "call"); // 팟 40
    s = checkThrough(s);
    expect(s.phase).toBe("bet1");
    expect(s.rematchNo).toBe(1);
    expect(s.carried).toEqual([{ amount: 40, eligible: ["p0", "p1"] }]);
    expect(s.seats.every((x) => x.handContrib === 0)).toBe(true);
    s = checkThrough(s);
    expect(s.phase).toBe("done");
    expect(s.result!.payouts).toEqual({ p0: 40 });
  });

  it("rematches 구사 with everyone and keeps non-participants out", () => {
    // 3인: p0 구사(4·9), p1 5끗, p2 8끗 → 구사 재경기, 전원 참가
    const gusa = deck([N(4), N(2), S(2), N(9), N(3), N(6)]);
    let s = createSutdaHand(params(3), [gusa, deck([S(10), N(1), N(3), N(10), N(2), N(4)]), deck([]), deck([])]);
    s = checkThrough(s);
    expect(s.rematchNo).toBe(1);
    expect(s.participants.sort()).toEqual(["p0", "p1", "p2"]);
    s = checkThrough(s);
    expect(s.phase).toBe("done");
    expect(Object.values(s.result!.payouts).reduce((a, b) => a + b, 0)).toBe(30);
  });

  it(`splits the pot after ${MAX_REMATCHES} rematches without a decision`, () => {
    const tie = deck([S(2), S(6), N(3), N(9)]);
    let s = createSutdaHand(params(2), [tie, tie, tie, tie]);
    for (let i = 0; i <= MAX_REMATCHES; i++) s = checkThrough(s);
    expect(s.phase).toBe("done");
    expect(s.result!.splitAfterMaxRematches).toBe(true);
    expect(s.result!.payouts).toEqual({ p0: 10, p1: 10 });
  });

  it("pays the main pot before a side-pot rematch and keeps its winner as next boss", () => {
    const p = params(3);
    p.seats[0].stack = 20;
    // 1장째 [p0,p1,p2], 2장째 [p0,p1,p2] → p0 9땡, p1 5끗, p2 5끗
    const first = deck([S(9), S(2), N(7), N(9), N(3), N(8)]);
    const rematch = deck([S(10), N(1), N(10), N(2)]); // p1 장땡, p2 알리 (p0은 빠짐)
    let s = createSutdaHand(p, [first, rematch, deck([]), deck([])]);
    s = act(s, "ping"); // p0 올인
    s = act(s, "half");
    s = act(s, "call");
    s = checkThrough(s);
    expect(s.rematchNo).toBe(1);
    expect(s.participants.sort()).toEqual(["p1", "p2"]);
    expect(s.mainWinnerId).toBe("p0");
    expect(s.history).toHaveLength(1);
    expect(s.history[0].reasons).toEqual(["동점"]);
    expect(s.history[0].cards.every((c) => c.faceUp)).toBe(true);
    s = checkThrough(s);
    expect(s.phase).toBe("done");
    expect(s.result!.winnerId).toBe("p0");
    expect(s.result!.payouts.p0).toBe(60);
    expect(s.result!.payouts.p1).toBeGreaterThan(0);
    expect(s.result!.payouts.p2).toBeUndefined();
  });

  it("lets players who died rejoin a 구사 rematch for half the pot", () => {
    // 1장째 [p0,p1,p2], 2장째 [p0,p1,p2] → p0 구사(4·9), p1 5끗, p2는 1차에서 다이
    const first = deck([N(4), N(2), S(5), N(9), N(3), N(6)]);
    const rematch = deck([S(10), N(1), N(2), N(10), N(3), N(5)]); // p0 장땡, p1 1·3=4끗, p2 2·5=7끗
    let s = createSutdaHand(params(3), [first, rematch, deck([]), deck([])]);
    s = act(s, "ping"); // p0 (팟 40)
    s = act(s, "call"); // p1 (팟 50)
    s = act(s, "die"); // p2
    s = checkThrough(s);
    expect(s.phase).toBe("rejoin");
    expect(s.history[0].reasons).toEqual(["구사"]);
    expect(s.rejoin).toEqual({ fee: 25, candidates: ["p2"], decided: [], gusaPots: [0] });
    expect(totalChips(s)).toBe(3000);
    expect(() => reduceSutda(s, { type: "bet", seatId: "p0", action: "check" })).toThrow();

    s = reduceSutda(s, { type: "rejoin", seatId: "p2", join: true });
    expect(s.phase).toBe("bet1");
    expect(s.rematchNo).toBe(1);
    expect(s.participants.sort()).toEqual(["p0", "p1", "p2"]);
    expect(s.carried).toEqual([{ amount: 75, eligible: ["p0", "p1", "p2"] }]);
    expect(s.cards).toHaveLength(3);
    expect(totalChips(s)).toBe(3000);
    s = checkThrough(s);
    expect(s.phase).toBe("done");
    expect(s.result!.payouts).toEqual({ p0: 75 });
  });

  it("keeps rejoin choices secret until everyone has decided", () => {
    // 4인: p0 구사, p1 5끗, p2·p3 다이
    const first = deck([N(4), N(2), S(5), S(7), N(9), N(3), N(6), N(7)]);
    let s = createSutdaHand(params(4), [first, deck([]), deck([]), deck([])]);
    s = act(act(act(act(s, "ping"), "call"), "die"), "die");
    s = checkThrough(s);
    expect(s.phase).toBe("rejoin");
    expect(s.rejoin!.candidates).toEqual(["p2", "p3"]);
    const before = JSON.stringify(viewSutda(s, "p3"));
    s = reduceSutda(s, { type: "rejoin", seatId: "p2", join: true });
    const v = viewSutda(s, "p3");
    expect(v.rejoin!.decided).toEqual(["p2"]);
    expect(JSON.stringify(v)).not.toContain("rejoinChoices");
    // 스택·팟은 전원이 정하기 전엔 그대로
    expect(v.seats.find((x) => x.id === "p2")!.stack).toBe(JSON.parse(before).seats.find((x: { id: string }) => x.id === "p2").stack);
    expect(v.carried).toEqual(JSON.parse(before).carried);
    s = reduceSutda(s, { type: "rejoin", seatId: "p3", join: false });
    expect(s.phase).toBe("bet1");
    expect(s.participants.sort()).toEqual(["p0", "p1", "p2"]);
    expect(s.secrets.rejoinChoices).toBeUndefined();
  });

  it("charges and grants eligibility only for 구사 pots when a tie pot is also rematched", () => {
    const p = params(4);
    p.seats[0].stack = 20;
    // p0 구사(올인), p1 5끗, p2 5끗, p3 다이 → 메인 팟 구사 재경기, 사이드 팟 p1·p2 동점 재경기
    const first = deck([N(4), S(2), S(6), N(5), S(9), N(3), N(9), N(6)]);
    let s = createSutdaHand(p, [first, deck([]), deck([]), deck([])]);
    s = act(s, "ping");
    s = act(s, "half");
    s = act(s, "call");
    s = act(s, "die");
    s = checkThrough(s);
    expect(s.phase).toBe("rejoin");
    expect(s.history[0].reasons.sort()).toEqual(["구사", "동점"]);
    const [main, side] = s.carried;
    expect(s.rejoin!.gusaPots).toEqual([0]);
    expect(s.rejoin!.fee).toBe(Math.floor(main.amount / 2));
    s = reduceSutda(s, { type: "rejoin", seatId: "p3", join: true });
    expect(s.carried[0]).toEqual({ amount: main.amount + Math.floor(main.amount / 2), eligible: [...main.eligible, "p3"] });
    expect(s.carried[1]).toEqual(side);
    expect(s.carried[1].eligible).not.toContain("p3");
  });

  it("treats undecided rejoin candidates as passing on timeout", () => {
    const first = deck([N(4), N(2), S(5), N(9), N(3), N(6)]);
    let s = createSutdaHand(params(3), [first, deck([S(10), N(1), N(10), N(2)]), deck([]), deck([])]);
    s = act(act(act(s, "ping"), "call"), "die");
    s = checkThrough(s);
    expect(s.phase).toBe("rejoin");
    s = reduceSutda(s, { type: "rejoin_timeout" });
    expect(s.phase).toBe("bet1");
    expect(s.participants.sort()).toEqual(["p0", "p1"]);
  });

  it("does not offer rejoining for a tie rematch", () => {
    // p0 5끗, p1 5끗, p2 다이 → 동점 재경기, 참여 대기 없음
    const first = deck([S(2), S(6), N(5), N(3), N(9), N(6)]);
    let s = createSutdaHand(params(3), [first, deck([S(10), N(1), N(10), N(2)]), deck([]), deck([])]);
    s = act(act(act(s, "ping"), "call"), "die");
    s = checkThrough(s);
    expect(s.phase).toBe("bet1");
    expect(s.rematchNo).toBe(1);
    expect(s.rejoin).toBeNull();
  });

  it("does not flag a split when the last allowed rematch has a winner", () => {
    const tie = deck([S(2), S(6), N(3), N(9)]);
    const p0wins = deck([S(10), N(1), N(10), N(2)]);
    let s = createSutdaHand(params(2), [tie, tie, tie, p0wins]);
    for (let i = 0; i <= MAX_REMATCHES; i++) s = checkThrough(s);
    expect(s.phase).toBe("done");
    expect(s.rematchNo).toBe(MAX_REMATCHES);
    expect(s.result!.splitAfterMaxRematches).toBe(false);
    expect(s.result!.payouts).toEqual({ p0: 20 });
  });

  it("rejects non-positive base bets and bad stacks", () => {
    expect(() => createSutdaHand({ ...params(2), baseBet: 0 })).toThrow();
    const p = params(2);
    p.seats[1].stack = -5;
    expect(() => createSutdaHand(p)).toThrow();
  });

  it("applies timeouts as check when possible, otherwise die", () => {
    let s = createSutdaHand(params(2));
    s = reduceSutda(s, { type: "timeout", seatId: "p0" });
    expect(s.seats[0].folded).toBe(false);
    s = act(s, "half");
    s = reduceSutda(s, { type: "timeout", seatId: "p0" });
    expect(s.seats[0].folded).toBe(true);
    expect(s.phase).toBe("done");
  });

  it("rejects actions out of turn and after the hand", () => {
    const s = createSutdaHand(params(2));
    expect(() => reduceSutda(s, { type: "bet", seatId: "p1", action: "check" })).toThrow();
    const done = act(act(s, "ping"), "die");
    expect(() => reduceSutda(done, { type: "bet", seatId: "p0", action: "check" })).toThrow();
  });

  it("uses the RNG spec for decks and replays deterministically", () => {
    const p = params(4);
    const decks = sutdaDecks(p);
    expect(decks).toHaveLength(MAX_REMATCHES + 1);
    expect(new Set(decks.map((d) => d.join(","))).size).toBe(decks.length);
    const log: SutdaAction[] = [];
    let s = createSutdaHand(p);
    while (s.phase !== "done") {
      const a = pickAction(s, (n) => log.length % n);
      log.push(a);
      s = reduceSutda(s, a);
    }
    expect(replay(createSutdaHand(p), reduceSutda, log)).toEqual(s);
  });
});

describe("sutda conservation (fuzz)", () => {
  it("keeps total chips constant across random hands", () => {
    let seed = 7;
    const rand = (n: number) => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed % n;
    };
    for (let h = 0; h < 500; h++) {
      const n = 2 + rand(5);
      const p = params(n);
      p.handId = `fuzz-${h}`;
      p.seats = p.seats.map((x) => ({ ...x, stack: 10 + rand(500) }));
      p.serverSeed = rand(1e9).toString(16).padStart(8, "0").repeat(8);
      const start = p.seats.reduce((a, x) => a + x.stack, 0);
      let s = createSutdaHand(p);
      let steps = 0;
      while (s.phase !== "done") {
        expect(totalChips(s)).toBe(start);
        s = reduceSutda(s, pickAction(s, rand));
        expect(++steps).toBeLessThan(500);
      }
      expect(s.seats.reduce((a, x) => a + x.stack, 0)).toBe(start);
      expect(s.seats.every((x) => x.stack >= 0 && x.handContrib === 0)).toBe(true);
    }
  });
});
