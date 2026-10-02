// 홀덤 족보 — holdem-arch.md 결정 2. 국제 표준: 키커 있음, 무늬는 비교에 안 씀, A-2-3-4-5(휠)가 가장 낮은 스트레이트.
// 카드 id는 포커와 같다 (0~51, rankOf 2~14, A = 14).
import { rankOf, suitOf, type PokerCard } from "../poker7/hands";

export const HOLDEM_CATEGORIES = [
  "하이카드",
  "원페어",
  "투페어",
  "트리플",
  "스트레이트",
  "플러시",
  "풀하우스",
  "포카드",
  "스트레이트 플러시",
  "로열 플러시",
] as const;
export type HoldemCategory = (typeof HOLDEM_CATEGORIES)[number];

export type HoldemHand = {
  category: HoldemCategory;
  /** 사전순 비교: [족보 0~8, 주요 숫자…, 키커…]. 클수록 강함. 로열 플러시는 [8, 14]. */
  score: number[];
  cards: PokerCard[];
};

/** 5장의 숫자(서로 다름)가 스트레이트면 가장 높은 카드, 아니면 null. 휠은 5. */
function straightTop(desc: readonly number[]): number | null {
  if (new Set(desc).size !== 5) return null;
  if (desc[0] - desc[4] === 4) return desc[0];
  if (desc[0] === 14 && desc[1] === 5 && desc[4] === 2) return 5;
  return null;
}

function evaluateFive(cards: readonly PokerCard[]): HoldemHand {
  const desc = cards.map(rankOf).sort((a, b) => b - a);
  const flush = cards.every((c) => suitOf(c) === suitOf(cards[0]));
  const top = straightTop(desc);
  const hand = (category: HoldemCategory, score: number[]): HoldemHand => ({ category, score, cards: [...cards] });
  if (top !== null && flush) return hand(top === 14 ? "로열 플러시" : "스트레이트 플러시", [8, top]);

  // 같은 숫자끼리 묶기: 개수 많은 순, 같으면 숫자 높은 순
  const counts = new Map<number, number>();
  for (const r of desc) counts.set(r, (counts.get(r) ?? 0) + 1);
  const groups = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  const kickers = (...used: number[]) => desc.filter((r) => !used.includes(r));

  if (groups[0][1] === 4) return hand("포카드", [7, groups[0][0], ...kickers(groups[0][0])]);
  if (groups[0][1] === 3 && groups[1][1] === 2) return hand("풀하우스", [6, groups[0][0], groups[1][0]]);
  if (flush) return hand("플러시", [5, ...desc]);
  if (top !== null) return hand("스트레이트", [4, top]);
  if (groups[0][1] === 3) return hand("트리플", [3, groups[0][0], ...kickers(groups[0][0])]);
  if (groups[0][1] === 2 && groups[1][1] === 2) {
    return hand("투페어", [2, groups[0][0], groups[1][0], ...kickers(groups[0][0], groups[1][0])]);
  }
  if (groups[0][1] === 2) return hand("원페어", [1, groups[0][0], ...kickers(groups[0][0])]);
  return hand("하이카드", [0, ...desc]);
}

export function compareHoldem(a: readonly number[], b: readonly number[]): number {
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

/** 5~7장 중 가장 좋은 5장 */
export function bestHoldem(cards: readonly PokerCard[]): HoldemHand {
  if (cards.length < 5 || cards.length > 7 || new Set(cards).size !== cards.length) throw new Error("bad holdem cards");
  let best: HoldemHand | null = null;
  for (const five of combinations(cards, 5)) {
    const h = evaluateFive(five);
    if (!best || compareHoldem(h.score, best.score) > 0) best = h;
  }
  return best!;
}

/** 지금 가진 카드로 만든 족보 이름 (5장 미만이면 페어·트리플·포카드·하이카드까지만) — 족보 패널용 */
export function currentHoldemCategory(cards: readonly PokerCard[]): HoldemCategory | null {
  if (cards.length === 0) return null;
  if (cards.length >= 5) return bestHoldem(cards).category;
  const counts = new Map<number, number>();
  for (const c of cards) counts.set(rankOf(c), (counts.get(rankOf(c)) ?? 0) + 1);
  const sizes = [...counts.values()].sort((a, b) => b - a);
  if (sizes[0] === 4) return "포카드";
  if (sizes[0] === 3) return "트리플";
  if (sizes[0] === 2 && sizes[1] === 2) return "투페어";
  if (sizes[0] === 2) return "원페어";
  return "하이카드";
}
