// 7포커 족보 — docs/design/card-games-rules.md "포커 (7포커 · 초이스 룰)".
// 카드 번호 0~51 = 무늬(♠ ♦ ♥ ♣) × 13 + (숫자 − 2). 숫자 2~14 (A = 14).

export type PokerCard = number;

export const DECK_SIZE = 52;
export const SUITS = ["♠", "♦", "♥", "♣"] as const;

export const rankOf = (c: PokerCard) => (c % 13) + 2;
export const suitOf = (c: PokerCard) => Math.floor(c / 13);
/** 무늬 세기: 스페이드 > 다이아 > 하트 > 클로버 */
export const suitStrength = (c: PokerCard) => 3 - suitOf(c);

export function cardName(c: PokerCard): string {
  const r = rankOf(c);
  const face = r === 14 ? "A" : r === 13 ? "K" : r === 12 ? "Q" : r === 11 ? "J" : String(r);
  return `${SUITS[suitOf(c)]}${face}`;
}

export const CATEGORIES = [
  "탑",
  "원페어",
  "투페어",
  "트리플",
  "스트레이트",
  "백스트레이트",
  "마운틴",
  "플러시",
  "풀하우스",
  "포카드",
  "스트레이트 플러시",
  "백 스트레이트 플러시",
  "로열 스트레이트 플러시",
] as const;
export type Category = (typeof CATEGORIES)[number];

export type PokerHand = {
  category: Category;
  /** 사전순으로 비교: [족보, 숫자들…, 무늬]. 클수록 강함. */
  score: number[];
  cards: PokerCard[];
};

const cat = (c: Category) => CATEGORIES.indexOf(c);

/** 같은 숫자 카드 중 가장 센 무늬 */
const bestSuit = (cards: readonly PokerCard[], rank: number) =>
  Math.max(...cards.filter((c) => rankOf(c) === rank).map(suitStrength));

/** 정확히 5장 → 족보. 동점 판정은 족보를 이루는 카드만 본다 (키커 없음). */
function evaluateFive(cards: readonly PokerCard[]): PokerHand {
  const ranks = cards.map(rankOf).sort((a, b) => b - a);
  const flush = cards.every((c) => suitOf(c) === suitOf(cards[0]));
  const unique = [...new Set(ranks)];
  const isWheel = unique.length === 5 && ranks[0] === 14 && ranks[1] === 5;
  const isRun = unique.length === 5 && ranks[0] - ranks[4] === 4;
  const highCard = cards.reduce((best, c) =>
    rankOf(c) > rankOf(best) || (rankOf(c) === rankOf(best) && suitStrength(c) > suitStrength(best)) ? c : best,
  );
  const aceSuit = () => suitStrength(cards.find((c) => rankOf(c) === 14)!);

  if (isRun || isWheel) {
    const mountain = isRun && ranks[0] === 14;
    if (flush) {
      if (mountain) return { category: "로열 스트레이트 플러시", score: [cat("로열 스트레이트 플러시"), aceSuit()], cards: [...cards] };
      if (isWheel) return { category: "백 스트레이트 플러시", score: [cat("백 스트레이트 플러시"), aceSuit()], cards: [...cards] };
      return { category: "스트레이트 플러시", score: [cat("스트레이트 플러시"), ranks[0], suitStrength(highCard)], cards: [...cards] };
    }
    if (mountain) return { category: "마운틴", score: [cat("마운틴"), aceSuit()], cards: [...cards] };
    if (isWheel) return { category: "백스트레이트", score: [cat("백스트레이트"), aceSuit()], cards: [...cards] };
    return { category: "스트레이트", score: [cat("스트레이트"), ranks[0], suitStrength(highCard)], cards: [...cards] };
  }
  if (flush) return { category: "플러시", score: [cat("플러시"), ...ranks, suitStrength(highCard)], cards: [...cards] };
  return evaluateGroups(cards);
}

/** 페어·트리플·포카드·탑 (카드 1~5장). 오픈 카드로 보스를 정할 때도 쓴다. */
function evaluateGroups(cards: readonly PokerCard[]): PokerHand {
  const counts = new Map<number, number>();
  for (const c of cards) counts.set(rankOf(c), (counts.get(rankOf(c)) ?? 0) + 1);
  const groups = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  const [topRank, topCount] = groups[0];
  const second = groups[1];

  if (topCount === 4) return { category: "포카드", score: [cat("포카드"), topRank], cards: [...cards] };
  if (topCount === 3 && second?.[1] >= 2) return { category: "풀하우스", score: [cat("풀하우스"), topRank], cards: [...cards] };
  if (topCount === 3) return { category: "트리플", score: [cat("트리플"), topRank], cards: [...cards] };
  if (topCount === 2 && second?.[1] === 2) {
    const hi = Math.max(topRank, second[0]);
    const lo = Math.min(topRank, second[0]);
    return { category: "투페어", score: [cat("투페어"), hi, lo, bestSuit(cards, hi)], cards: [...cards] };
  }
  if (topCount === 2) return { category: "원페어", score: [cat("원페어"), topRank, bestSuit(cards, topRank)], cards: [...cards] };
  const ranks = cards.map(rankOf).sort((a, b) => b - a);
  return { category: "탑", score: [cat("탑"), ...ranks, bestSuit(cards, ranks[0])], cards: [...cards] };
}

export function compareScores(a: readonly number[], b: readonly number[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? -1) - (b[i] ?? -1);
    if (d !== 0) return d;
  }
  return 0;
}

function combinations<T>(items: readonly T[], k: number): T[][] {
  if (k === 0) return [[]];
  if (items.length < k) return [];
  const [head, ...rest] = items;
  return [...combinations(rest, k - 1).map((c) => [head, ...c]), ...combinations(rest, k)];
}

/** 5~7장 중 가장 센 5장. */
export function bestHand(cards: readonly PokerCard[]): PokerHand {
  if (cards.length < 5 || cards.length > 7 || new Set(cards).size !== cards.length) throw new Error("bad poker cards");
  let best: PokerHand | null = null;
  for (const five of combinations(cards, 5)) {
    const h = evaluateFive(five);
    if (!best || compareScores(h.score, best.score) > 0) best = h;
  }
  return best!;
}

/** 오픈 카드(1~4장)만으로 보스 판정: 포카드 > 트리플 > 투페어 > 원페어 > 탑 */
export function openCardsHand(cards: readonly PokerCard[]): PokerHand {
  if (cards.length < 1 || cards.length > 4) throw new Error("open cards must be 1~4");
  return evaluateGroups(cards);
}
