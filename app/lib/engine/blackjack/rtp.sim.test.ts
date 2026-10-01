// RTP 시뮬레이션 — blackjack-arch.md 결정 3 "검증 방법". 무거워서 평소 테스트에서는 건너뛴다.
// 실행: BJ_RTP=1 npx vitest run lib/engine/blackjack/rtp  (판 수는 BJ_RTP_HANDS, 기본 1,000만)
import { describe, expect, it } from "vitest";
import { createBlackjackHand, legalBlackjack, reduceBlackjack, type BjMove, type BlackjackState } from "./game";
import { SHOE_SIZE, cardValue, handTotal } from "./hands";

/** 6덱 S17 DAS 노서렌더 기본 전략. up: 딜러 오픈 점수 (A = 11) */
function strategy(cards: number[], up: number, canSplit: boolean): "H" | "S" | "D" | "Ds" | "P" {
  const v = cards.map(cardValue);
  if (canSplit && cards.length === 2 && v[0] === v[1]) {
    const pv = v[0];
    const p =
      pv === 1 || pv === 8 ||
      ((pv === 2 || pv === 3 || pv === 7) && up <= 7) ||
      (pv === 4 && (up === 5 || up === 6)) ||
      (pv === 6 && up <= 6) ||
      (pv === 9 && up !== 7 && up !== 10 && up !== 11);
    if (p) return "P";
  }
  const { total, soft } = handTotal(cards);
  if (soft) {
    if (total >= 19) return "S";
    if (total === 18) return up >= 3 && up <= 6 ? "Ds" : up <= 8 ? "S" : "H";
    if (total === 17) return up >= 3 && up <= 6 ? "D" : "H";
    if (total >= 15) return up >= 4 && up <= 6 ? "D" : "H";
    if (total === 12) return "H";
    return up >= 5 && up <= 6 ? "D" : "H";
  }
  if (total >= 17) return "S";
  if (total >= 13) return up <= 6 ? "S" : "H";
  if (total === 12) return up >= 4 && up <= 6 ? "S" : "H";
  if (total === 11) return up <= 10 ? "D" : "H";
  if (total === 10) return up <= 9 ? "D" : "H";
  if (total === 9) return up >= 3 && up <= 6 ? "D" : "H";
  return "H";
}

function decide(s: BlackjackState): BjMove {
  const { seatId, handIdx } = s.toAct!;
  const legal = legalBlackjack(s, seatId);
  const hand = s.seats.find((x) => x.id === seatId)!.hands[handIdx];
  const upV = cardValue(s.dealer.cards[0]);
  const a = strategy(hand.cards, upV === 1 ? 11 : upV, legal.includes("split"));
  if (a === "P") return "split";
  if (a === "D") return legal.includes("double") ? "double" : "hit";
  if (a === "Ds") return legal.includes("double") ? "double" : "stand";
  return a === "H" ? "hit" : "stand";
}

/** 빠른 PRNG (시뮬레이션 전용, 공정성 RNG 아님) */
function mulberry32(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) >>> 0;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe.runIf(process.env.BJ_RTP === "1")("블랙잭 RTP (기본 전략)", () => {
  it("stays within 99.45% ~ 99.65% of initial bets", () => {
    const hands = Number(process.env.BJ_RTP_HANDS ?? 10_000_000);
    const rand = mulberry32(20261001);
    const shoe = Array.from({ length: SHOE_SIZE }, (_, i) => i);
    const p = { handId: "rtp", baseBet: 10, seats: [{ id: "p0", seatNo: 0, stack: 1000 }], serverSeed: "00".repeat(32), seeds: [] };
    let net = 0;
    let sumSq = 0;
    for (let n = 0; n < hands; n++) {
      for (let i = shoe.length - 1; i >= 1; i--) {
        const j = Math.floor(rand() * (i + 1));
        [shoe[i], shoe[j]] = [shoe[j], shoe[i]];
      }
      let s = reduceBlackjack(createBlackjackHand(p, shoe.slice()), { type: "bet", seatId: "p0", amount: 10 });
      while (s.phase === "play") s = reduceBlackjack(s, { type: "move", seatId: "p0", move: decide(s) });
      const d = s.result!.deltas.p0 / 10;
      net += d;
      sumSq += d * d;
    }
    const mean = net / hands;
    const se = Math.sqrt(sumSq / hands - mean * mean) / Math.sqrt(hands);
    const rtp = 100 * (1 + mean);
    console.log(`hands=${hands} RTP=${rtp.toFixed(3)}% ±${(100 * se).toFixed(3)}%p (1σ)`);
    expect(rtp).toBeGreaterThan(99.45);
    expect(rtp).toBeLessThan(99.65);
  }, 900_000);
});
