// 섯다 족보·판정 — docs/design/card-games-rules.md "섯다".
// 카드 번호 0~19: 월 = floor(i/2)+1, 짝수 번호가 그 달의 특수패(1·3·8월 광, 4·7·9월 열끗).

export type SutdaCard = number;

export const DECK_SIZE = 20;

export function monthOf(card: SutdaCard): number {
  return Math.floor(card / 2) + 1;
}

export function isSpecial(card: SutdaCard): boolean {
  return card % 2 === 0;
}

export type HandKind =
  | "38광땡"
  | "광땡"
  | "땡"
  | "알리"
  | "독사"
  | "구삥"
  | "장삥"
  | "장사"
  | "세륙"
  | "끗"
  | "암행어사"
  | "땡잡이"
  | "구사"
  | "멍텅구리구사";

export type SutdaHand = {
  kind: HandKind;
  /** 평소 값으로 비교할 때의 순위. 클수록 강함. */
  value: number;
  /** 사람이 읽는 이름 (예: "9땡", "갑오", "3끗") */
  label: string;
};

const V_38 = 1000;
const V_GWANG = 900;
const V_DDANG = 800; // + 월(1~10)
const V_ALI = 700;
const V_DOKSA = 690;
const V_GUPPING = 680;
const V_JANGPPING = 670;
const V_JANGSA = 660;
const V_SERYUK = 650;
const V_KKEUT = 500; // + 끗(0~9)

function has(months: [number, number], a: number, b: number): boolean {
  return (months[0] === a && months[1] === b) || (months[0] === b && months[1] === a);
}

function kkeut(k: number): SutdaHand {
  const label = k === 9 ? "갑오" : k === 0 ? "망통" : `${k}끗`;
  return { kind: "끗", value: V_KKEUT + k, label };
}

export function evaluate(c1: SutdaCard, c2: SutdaCard): SutdaHand {
  if (c1 === c2 || c1 < 0 || c2 < 0 || c1 >= DECK_SIZE || c2 >= DECK_SIZE) throw new Error("bad sutda cards");
  const months: [number, number] = [monthOf(c1), monthOf(c2)];
  const bothSpecial = isSpecial(c1) && isSpecial(c2);

  if (bothSpecial && has(months, 3, 8)) return { kind: "38광땡", value: V_38, label: "38광땡" };
  if (bothSpecial && (has(months, 1, 3) || has(months, 1, 8))) {
    return { kind: "광땡", value: V_GWANG, label: months.includes(3) ? "13광땡" : "18광땡" };
  }
  if (bothSpecial && has(months, 4, 7)) return { kind: "암행어사", value: V_KKEUT + 1, label: "암행어사" };
  if (bothSpecial && has(months, 3, 7)) return { kind: "땡잡이", value: V_KKEUT + 0, label: "땡잡이" };
  if (months[0] === months[1]) {
    const m = months[0];
    return { kind: "땡", value: V_DDANG + m, label: m === 10 ? "장땡" : `${m}땡` };
  }
  if (has(months, 4, 9)) {
    return bothSpecial
      ? { kind: "멍텅구리구사", value: V_KKEUT + 3, label: "멍텅구리구사" }
      : { kind: "구사", value: V_KKEUT + 3, label: "구사" };
  }
  if (has(months, 1, 2)) return { kind: "알리", value: V_ALI, label: "알리" };
  if (has(months, 1, 4)) return { kind: "독사", value: V_DOKSA, label: "독사" };
  if (has(months, 1, 9)) return { kind: "구삥", value: V_GUPPING, label: "구삥" };
  if (has(months, 1, 10)) return { kind: "장삥", value: V_JANGPPING, label: "장삥" };
  if (has(months, 4, 10)) return { kind: "장사", value: V_JANGSA, label: "장사" };
  if (has(months, 4, 6)) return { kind: "세륙", value: V_SERYUK, label: "세륙" };
  return kkeut((months[0] + months[1]) % 10);
}

export type Resolution =
  | { type: "win"; winners: string[] }
  | { type: "rematch"; participants: string[]; reason: "구사" | "동점" };

const isGwangDdang = (v: number) => v === V_GWANG;
const isCatchableDdang = (v: number) => v >= V_DDANG + 1 && v <= V_DDANG + 9;

/** 규칙 문서 "판정 알고리즘": 잡기 반복 → 구사 재경기 → 동점 재경기 → 승자. */
export function resolve(candidates: readonly { id: string; hand: SutdaHand }[]): Resolution {
  if (candidates.length === 0) throw new Error("no candidates");
  let pool = [...candidates];

  for (;;) {
    const top = Math.max(...pool.map((c) => c.hand.value));
    const catcher = isGwangDdang(top)
      ? pool.some((c) => c.hand.kind === "암행어사")
      : isCatchableDdang(top) && pool.some((c) => c.hand.kind === "땡잡이");
    if (!catcher) break;
    pool = pool.filter((c) => c.hand.value !== top);
  }

  const gusa = pool.filter((c) => c.hand.kind === "구사" || c.hand.kind === "멍텅구리구사");
  if (gusa.length > 0) {
    const others = pool.filter((c) => !gusa.includes(c));
    const bestOther = others.length === 0 ? -Infinity : Math.max(...others.map((c) => c.hand.value));
    const triggers = gusa.some((g) =>
      g.hand.kind === "멍텅구리구사" ? bestOther <= V_DDANG + 9 : bestOther <= V_ALI,
    );
    if (triggers) return { type: "rematch", participants: candidates.map((c) => c.id), reason: "구사" };
  }

  const top = Math.max(...pool.map((c) => c.hand.value));
  const leaders = pool.filter((c) => c.hand.value === top).map((c) => c.id);
  if (leaders.length > 1) return { type: "rematch", participants: leaders, reason: "동점" };
  return { type: "win", winners: leaders };
}
