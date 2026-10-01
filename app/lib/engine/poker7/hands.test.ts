import { describe, expect, it } from "vitest";
import { bestHand, cardName, compareScores, openCardsHand, type PokerCard } from "./hands";

// 무늬: 0 ♠, 1 ♦, 2 ♥, 3 ♣ / 숫자 2~14
const S = 0,
  D = 1,
  H = 2,
  C = 3;
const c = (suit: number, rank: number): PokerCard => suit * 13 + (rank - 2);
const hand = (...cards: PokerCard[]) => bestHand(cards);

describe("7포커 족보 순서", () => {
  it("orders all categories the Korean way", () => {
    const chain = [
      hand(c(S, 14), c(S, 13), c(S, 12), c(S, 11), c(S, 10)), // 로티플
      hand(c(S, 14), c(S, 2), c(S, 3), c(S, 4), c(S, 5)), // 백스티플
      hand(c(S, 9), c(S, 8), c(S, 7), c(S, 6), c(S, 5)), // 스티플
      hand(c(S, 2), c(D, 2), c(H, 2), c(C, 2), c(S, 3)), // 포카드
      hand(c(S, 3), c(D, 3), c(H, 3), c(C, 2), c(S, 2)), // 풀하우스
      hand(c(H, 2), c(H, 5), c(H, 7), c(H, 9), c(H, 11)), // 플러시
      hand(c(S, 14), c(D, 13), c(H, 12), c(C, 11), c(S, 10)), // 마운틴
      hand(c(S, 14), c(D, 2), c(H, 3), c(C, 4), c(S, 5)), // 백스트레이트
      hand(c(S, 13), c(D, 12), c(H, 11), c(C, 10), c(S, 9)), // 스트레이트
      hand(c(S, 2), c(D, 2), c(H, 2), c(C, 9), c(S, 7)), // 트리플
      hand(c(S, 3), c(D, 3), c(H, 2), c(C, 2), c(S, 9)), // 투페어
      hand(c(S, 14), c(D, 14), c(H, 2), c(C, 9), c(S, 7)), // 원페어
      hand(c(S, 14), c(D, 13), c(H, 9), c(C, 7), c(S, 5)), // 탑
    ];
    expect(chain.map((h) => h.category)).toEqual([
      "로열 스트레이트 플러시",
      "백 스트레이트 플러시",
      "스트레이트 플러시",
      "포카드",
      "풀하우스",
      "플러시",
      "마운틴",
      "백스트레이트",
      "스트레이트",
      "트리플",
      "투페어",
      "원페어",
      "탑",
    ]);
    for (let i = 1; i < chain.length; i++) expect(compareScores(chain[i - 1].score, chain[i].score)).toBeGreaterThan(0);
  });

  it("picks the best five of seven", () => {
    const h = hand(c(S, 2), c(D, 7), c(H, 9), c(S, 9), c(C, 9), c(D, 9), c(S, 14));
    expect(h.category).toBe("포카드");
    expect(hand(c(S, 5), c(S, 6), c(S, 7), c(S, 8), c(S, 9), c(D, 10), c(H, 11)).category).toBe("스트레이트 플러시");
  });
});

describe("동점 판정 (숫자 → 무늬, 키커 없음)", () => {
  it("breaks equal one pairs by the stronger suit in the pair", () => {
    const spadeAce = hand(c(S, 14), c(C, 14), c(H, 2), c(D, 3), c(C, 5));
    const heartAce = hand(c(H, 14), c(D, 14), c(S, 13), c(S, 12), c(S, 10));
    // 키커(K·Q·10)가 더 좋아도 페어 무늬(스페이드)가 이긴다
    expect(compareScores(spadeAce.score, heartAce.score)).toBeGreaterThan(0);
  });

  it("compares two pairs by high pair, low pair, then suit of the high pair", () => {
    const a = hand(c(D, 10), c(C, 10), c(S, 4), c(D, 4), c(H, 2));
    const b = hand(c(S, 10), c(H, 10), c(H, 4), c(C, 4), c(D, 2));
    expect(compareScores(b.score, a.score)).toBeGreaterThan(0); // b의 10 페어에 스페이드
    const c9 = hand(c(S, 9), c(H, 9), c(S, 8), c(H, 8), c(D, 2));
    expect(compareScores(a.score, c9.score)).toBeGreaterThan(0);
  });

  it("compares back straights by the suit of the ace", () => {
    const spadeAce = hand(c(S, 14), c(D, 2), c(H, 3), c(C, 4), c(D, 5));
    const clubAce = hand(c(C, 14), c(S, 2), c(S, 3), c(S, 4), c(H, 5));
    expect(compareScores(spadeAce.score, clubAce.score)).toBeGreaterThan(0);
  });

  it("compares high cards rank by rank, then the suit of the top card", () => {
    const a = hand(c(D, 14), c(S, 12), c(S, 9), c(S, 7), c(S, 5));
    const b = hand(c(S, 14), c(D, 12), c(D, 9), c(D, 7), c(D, 5));
    expect(compareScores(b.score, a.score)).toBeGreaterThan(0);
    const lower = hand(c(S, 14), c(S, 12), c(S, 9), c(S, 7), c(D, 4));
    expect(compareScores(a.score, lower.score)).toBeGreaterThan(0);
  });

  it("never ties between two different random 7-card hands from one deck", () => {
    let seed = 99;
    const rand = (n: number) => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed % n;
    };
    for (let i = 0; i < 3000; i++) {
      const deck = [...Array(52).keys()];
      for (let j = deck.length - 1; j > 0; j--) {
        const k = rand(j + 1);
        [deck[j], deck[k]] = [deck[k], deck[j]];
      }
      const a = bestHand(deck.slice(0, 7));
      const b = bestHand(deck.slice(7, 14));
      expect(compareScores(a.score, b.score)).not.toBe(0);
    }
  }, 60_000);
});

describe("오픈 카드 보스 판정", () => {
  it("ranks open cards by pairs only", () => {
    const pair = openCardsHand([c(C, 3), c(D, 3), c(S, 14)]);
    const high = openCardsHand([c(S, 14), c(S, 13), c(S, 12)]);
    expect(pair.category).toBe("원페어");
    expect(high.category).toBe("탑");
    expect(compareScores(pair.score, high.score)).toBeGreaterThan(0);
    expect(compareScores(openCardsHand([c(S, 9)]).score, openCardsHand([c(D, 9)]).score)).toBeGreaterThan(0);
  });

  it("names cards", () => {
    expect(cardName(c(S, 14))).toBe("♠A");
    expect(cardName(c(H, 10))).toBe("♥10");
  });
});
