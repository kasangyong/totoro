// 블랙잭 카드·점수 — blackjack-arch.md 결정 3·4.
// 카드 id 0~311 = 6덱. 무늬·숫자는 id % 52 (포커 카드와 같은 배치라 트럼프 그림을 그대로 쓴다).
import { rankOf } from "../poker7/hands";

export type BjCard = number;

export const DECKS = 6;
export const SHOE_SIZE = 52 * DECKS;

/** A = 1 (소프트 계산은 handTotal에서), J·Q·K = 10 */
export function cardValue(c: BjCard): number {
  const r = rankOf(c % 52);
  return r === 14 ? 1 : Math.min(r, 10);
}

export function handTotal(cards: readonly BjCard[]): { total: number; soft: boolean } {
  let total = 0;
  let ace = false;
  for (const c of cards) {
    const v = cardValue(c);
    total += v;
    if (v === 1) ace = true;
  }
  if (ace && total + 10 <= 21) return { total: total + 10, soft: true };
  return { total, soft: false };
}

/** 처음 2장 21. 스플릿한 손은 호출하는 쪽에서 제외한다 */
export function isNatural(cards: readonly BjCard[]): boolean {
  return cards.length === 2 && handTotal(cards).total === 21;
}
