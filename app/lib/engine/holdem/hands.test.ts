import { describe, expect, it } from "vitest";
import { bestHoldem, compareHoldem, currentHoldemCategory } from "./hands";

// 무늬 0 ♠, 1 ♦, 2 ♥, 3 ♣ · 숫자 2~14 (A = 14)
const c = (rank: number, suit = 0) => suit * 13 + (rank - 2);
const A = 14,
  K = 13,
  Q = 12,
  J = 11,
  T = 10;
const best = (cards: number[]) => bestHoldem(cards);
const cmp = (a: number[], b: number[]) => Math.sign(compareHoldem(best(a).score, best(b).score));

describe("홀덤 족보", () => {
  it("names every category", () => {
    expect(best([c(A), c(K, 1), c(9, 2), c(7, 3), c(4)]).category).toBe("하이카드");
    expect(best([c(A), c(A, 1), c(9, 2), c(7, 3), c(4)]).category).toBe("원페어");
    expect(best([c(A), c(A, 1), c(9, 2), c(9, 3), c(4)]).category).toBe("투페어");
    expect(best([c(9), c(9, 1), c(9, 2), c(7, 3), c(4)]).category).toBe("트리플");
    expect(best([c(9), c(8, 1), c(7, 2), c(6, 3), c(5)]).category).toBe("스트레이트");
    expect(best([c(A), c(J), c(9), c(7), c(4)]).category).toBe("플러시");
    expect(best([c(9), c(9, 1), c(9, 2), c(4, 3), c(4)]).category).toBe("풀하우스");
    expect(best([c(9), c(9, 1), c(9, 2), c(9, 3), c(4)]).category).toBe("포카드");
    expect(best([c(9), c(8), c(7), c(6), c(5)]).category).toBe("스트레이트 플러시");
    expect(best([c(A), c(K), c(Q), c(J), c(T)]).category).toBe("로열 플러시");
  });

  it("uses kickers and ignores suits", () => {
    // 같은 원페어 A, 키커 K > Q
    expect(cmp([c(A), c(A, 1), c(K, 2), c(7, 3), c(4), c(3, 1), c(2, 2)], [c(A, 2), c(A, 3), c(Q, 2), c(7, 1), c(4, 1), c(3), c(2, 3)])).toBe(1);
    // 무늬만 다르면 무승부
    expect(cmp([c(A), c(K, 1), c(9, 2), c(7, 3), c(4)], [c(A, 1), c(K, 2), c(9, 3), c(7), c(4, 1)])).toBe(0);
  });

  it("picks the two highest pairs out of three and the best kicker", () => {
    // 페어 K, 9, 4 + A → K·9 투페어, 키커 A
    const h = best([c(K), c(K, 1), c(9), c(9, 1), c(4), c(4, 1), c(A, 2)]);
    expect(h.category).toBe("투페어");
    expect(h.score).toEqual([2, K, 9, A]);
    // 키커만 다른 투페어
    expect(cmp([c(K), c(K, 1), c(9), c(9, 1), c(Q, 2)], [c(K, 2), c(K, 3), c(9, 2), c(9, 3), c(J, 2)])).toBe(1);
  });

  it("treats the wheel as the lowest straight and a wheel straight flush as 5-high", () => {
    const wheel = best([c(A), c(2, 1), c(3, 2), c(4, 3), c(5), c(K, 1), c(Q, 2)]);
    expect(wheel.score).toEqual([4, 5]);
    expect(cmp([c(A), c(2, 1), c(3, 2), c(4, 3), c(5)], [c(6), c(2, 1), c(3, 2), c(4, 3), c(5, 1)])).toBe(-1);
    expect(best([c(A, 3), c(2, 3), c(3, 3), c(4, 3), c(5, 3)]).score).toEqual([8, 5]);
  });

  it("ranks a flush over a straight on the same board", () => {
    // 보드 5·6·7·8 + 9♠(스트레이트) vs 내 패 ♥ 두 장으로 플러시
    const board = [c(5, 2), c(6, 2), c(7, 1), c(8, 2), c(K, 3)];
    expect(best([c(9), c(2, 3), ...board]).category).toBe("스트레이트");
    expect(best([c(A, 2), c(2, 2), ...board]).category).toBe("플러시");
    expect(cmp([c(A, 2), c(2, 2), ...board], [c(9), c(2, 3), ...board])).toBe(1);
  });

  it("compares quads on the board by kicker and full houses by trips then pair", () => {
    const quads = [c(9), c(9, 1), c(9, 2), c(9, 3), c(2)];
    expect(cmp([c(A), c(3), ...quads], [c(K, 1), c(3, 1), ...quads])).toBe(1);
    expect(cmp([c(4, 1), c(3), ...quads], [c(4, 2), c(3, 1), ...quads])).toBe(0);
    expect(cmp([c(9), c(9, 1), c(9, 2), c(2), c(2, 1)], [c(8), c(8, 1), c(8, 2), c(A), c(A, 1)])).toBe(1);
    expect(best([c(9), c(9, 1), c(9, 2), c(K), c(K, 1)]).score).toEqual([6, 9, K]);
  });

  it("plays the board when it is best for both (split)", () => {
    const board = [c(A), c(K, 1), c(Q, 2), c(J, 3), c(T)];
    expect(cmp([c(2, 1), c(3, 2), ...board], [c(4, 1), c(5, 2), ...board])).toBe(0);
  });

  it("gives a partial category before five cards", () => {
    expect(currentHoldemCategory([])).toBeNull();
    expect(currentHoldemCategory([c(A), c(A, 1)])).toBe("원페어");
    expect(currentHoldemCategory([c(A), c(K)])).toBe("하이카드");
    expect(currentHoldemCategory([c(A), c(A, 1), c(K), c(K, 1)])).toBe("투페어");
  });
});

describe("홀덤 족보 (보드 스트레이트 vs 내 플러시)", () => {
  it("beats a straight on the board with a flush made from my two cards", () => {
    const board = [c(5, 2), c(6, 2), c(7, 1), c(8, 2), c(9, 3)]; // 보드만으로 9-하이 스트레이트
    expect(best([c(K), c(3, 1), ...board]).category).toBe("스트레이트");
    expect(best([c(A, 2), c(2, 2), ...board]).category).toBe("플러시");
    expect(cmp([c(A, 2), c(2, 2), ...board], [c(K), c(3, 1), ...board])).toBe(1);
  });
});
