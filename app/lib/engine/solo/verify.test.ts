import { describe, expect, it } from "vitest";
import { crashPointFromSeed } from "./crash";
import { commitOf } from "../rng";
import {
  chickenDeathLane,
  chickenMult100,
  hiloCards,
  hiloHit,
  minesBoard,
  minesMult100,
  payoutOf,
  playDice,
  soloRng,
} from "./games";
import { verifyCrashRound, verifySoloBet, type RecordedBet } from "./verify";

const seed = { serverSeed: "5a".repeat(32), clientSeed: "a5".repeat(16), userId: "user-1" };
const rngAt = (nonce: number) => soloRng({ ...seed, nonce });

describe("verifySoloBet catches tampering", () => {
  it("dice: honest record passes, changed payout or roll fails", () => {
    const r = playDice(rngAt(0), 100, { mode: "under", target: 50 });
    const bet: RecordedBet = { game: "dice", nonce: 0, stake: 100, payout: r.payout, params: { mode: "under", target: 50 }, state: r, status: r.win ? "won" : "lost" };
    expect(verifySoloBet(bet, seed)).toBe(true);
    expect(verifySoloBet({ ...bet, payout: r.payout + 1 }, seed)).toBe(false);
    expect(verifySoloBet({ ...bet, state: { ...r, roll: (r.roll + 1) % 10001 } }, seed)).toBe(false);
  });

  it("mines: claiming a gem was a mine (or the reverse) fails", () => {
    const board = minesBoard(rngAt(1), 5);
    const gems = [...Array(25).keys()].filter((t) => !board.includes(t));
    const lost: RecordedBet = {
      game: "mines", nonce: 1, stake: 100, payout: 0, params: { mines: 5 },
      state: { mines: 5, revealed: [gems[0], board[0]], board }, status: "lost",
    };
    expect(verifySoloBet(lost, seed)).toBe(true);
    expect(verifySoloBet({ ...lost, state: { ...lost.state, revealed: [gems[0], gems[1]] } }, seed)).toBe(false);
    const won: RecordedBet = {
      game: "mines", nonce: 1, stake: 100, payout: payoutOf(100, minesMult100(5, 2)), params: { mines: 5 },
      state: { mines: 5, revealed: [gems[0], gems[1]], board }, status: "won",
    };
    expect(verifySoloBet(won, seed)).toBe(true);
    expect(verifySoloBet({ ...won, state: { ...won.state, revealed: [gems[0], board[0]] } }, seed)).toBe(false);
  });

  it("chicken: moving the accident lane fails", () => {
    const lane = chickenDeathLane(rngAt(2), "hard");
    const bet: RecordedBet = {
      game: "chicken", nonce: 2, stake: 100, payout: 0, params: { difficulty: "hard" },
      state: { crossed: lane - 1, deathLane: lane }, status: "lost",
    };
    expect(verifySoloBet(bet, seed)).toBe(true);
    expect(verifySoloBet({ ...bet, state: { crossed: lane, deathLane: lane + 1 } }, seed)).toBe(false);
    if (lane > 2) {
      const won: RecordedBet = { ...bet, payout: payoutOf(100, chickenMult100("hard", 1)), state: { crossed: 1, deathLane: lane }, status: "won" };
      expect(verifySoloBet(won, seed)).toBe(true);
    }
  });

  it("hilo: swapping the deciding card or faking a hit fails", () => {
    const cards = hiloCards(rngAt(3));
    // 첫 카드에서 일부러 틀리는 선택을 기록
    const r = cards[0].rank;
    const guess = r === 1 ? "same" : r === 13 ? "same" : "hi";
    const hit = hiloHit(r, guess, cards[1].rank);
    const bet: RecordedBet = {
      game: "hilo", nonce: 3, stake: 100, payout: 0, params: {},
      state: { current: cards[1], history: [{ card: cards[0], guess, hit }] }, status: hit ? "won" : "lost",
    };
    if (!hit) {
      expect(verifySoloBet(bet, seed)).toBe(true);
      expect(verifySoloBet({ ...bet, state: { ...bet.state, current: cards[2] } }, seed)).toBe(false);
      expect(verifySoloBet({ ...bet, state: { ...bet.state, history: [{ card: cards[0], guess, hit: true }] } }, seed)).toBe(false);
    }
    // 맞힌 게 없는데 환불이라고 주장 (카드를 다 쓰지 않음) → 불일치
    const refund: RecordedBet = { ...bet, payout: 100, status: "won", state: { current: cards[1], history: [{ card: cards[0], guess: "skip", hit: null }] } };
    expect(verifySoloBet(refund, seed)).toBe(false);
  });
});

describe("verifyCrashRound", () => {
  it("accepts the committed seed and rejects a changed crash point", () => {
    const s = "7c".repeat(32);
    const round = { commit: commitOf(s), seed: s, crashPoint100: crashPointFromSeed(s) };
    expect(verifyCrashRound(round)).toBe(true);
    expect(verifyCrashRound({ ...round, crashPoint100: round.crashPoint100 + 1 })).toBe(false);
    expect(verifyCrashRound({ ...round, seed: "7d".repeat(32) })).toBe(false);
  });
});
