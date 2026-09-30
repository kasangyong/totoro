import { describe, expect, it } from "vitest";
import { DECK_SIZE, evaluate, resolve, type HandKind } from "./hands";

/** 월 m의 특수패(광·열끗) / 일반패 */
const S = (m: number) => (m - 1) * 2;
const N = (m: number) => (m - 1) * 2 + 1;

const hand = (id: string, a: number, b: number) => ({ id, hand: evaluate(a, b) });

describe("sutda hand evaluation", () => {
  it("classifies all 190 two-card combinations", () => {
    const counts: Partial<Record<HandKind, number>> = {};
    for (let a = 0; a < DECK_SIZE; a++) {
      for (let b = a + 1; b < DECK_SIZE; b++) {
        const k = evaluate(a, b).kind;
        counts[k] = (counts[k] ?? 0) + 1;
      }
    }
    expect(counts).toEqual({
      "38광땡": 1,
      광땡: 2,
      땡: 10,
      암행어사: 1,
      땡잡이: 1,
      멍텅구리구사: 1,
      구사: 3,
      알리: 4,
      독사: 4,
      구삥: 4,
      장삥: 4,
      장사: 4,
      세륙: 4,
      끗: 190 - 43,
    });
  });

  it("orders the standard ranks", () => {
    const chain = [
      evaluate(S(3), S(8)), // 38광땡
      evaluate(S(1), S(8)), // 18광땡
      evaluate(S(10), N(10)), // 장땡
      evaluate(S(9), N(9)), // 9땡
      evaluate(S(1), N(1)), // 삥땡
      evaluate(N(1), N(2)), // 알리
      evaluate(N(1), N(4)), // 독사
      evaluate(N(1), N(9)), // 구삥
      evaluate(N(1), N(10)), // 장삥
      evaluate(N(4), N(10)), // 장사
      evaluate(N(4), N(6)), // 세륙
      evaluate(N(2), N(7)), // 갑오
      evaluate(N(2), N(3)), // 5끗
      evaluate(N(2), N(8)), // 망통
    ];
    for (let i = 1; i < chain.length; i++) expect(chain[i - 1].value).toBeGreaterThan(chain[i].value);
    expect(evaluate(S(1), S(3)).value).toBe(evaluate(S(1), S(8)).value);
    expect(evaluate(N(2), N(7)).label).toBe("갑오");
    expect(evaluate(N(2), N(8)).label).toBe("망통");
  });

  it("gives special hands their fallback values", () => {
    expect(evaluate(S(4), S(7))).toMatchObject({ kind: "암행어사", label: "암행어사" });
    expect(evaluate(S(4), S(7)).value).toBe(evaluate(N(2), N(9)).value); // 1끗
    expect(evaluate(S(3), S(7)).value).toBe(evaluate(N(2), N(8)).value); // 망통
    expect(evaluate(N(4), N(9)).value).toBe(evaluate(N(1), N(2)).value - 197); // 3끗 = 503
    expect(evaluate(S(4), S(9)).kind).toBe("멍텅구리구사");
    expect(evaluate(S(4), N(9)).kind).toBe("구사");
  });
});

describe("sutda resolution", () => {
  it("follows the documented examples", () => {
    // [일팔광땡, 9땡, 암행어사] → 9땡
    expect(resolve([hand("a", S(1), S(8)), hand("b", S(9), N(9)), hand("c", S(4), S(7))])).toEqual({
      type: "win",
      winners: ["b"],
    });
    // [장땡, 5땡, 땡잡이] → 장땡
    expect(resolve([hand("a", S(10), N(10)), hand("b", S(5), N(5)), hand("c", S(3), S(7))])).toEqual({
      type: "win",
      winners: ["a"],
    });
    // [9땡, 5땡, 땡잡이] → 땡잡이
    expect(resolve([hand("a", S(9), N(9)), hand("b", S(5), N(5)), hand("c", S(3), S(7))])).toEqual({
      type: "win",
      winners: ["c"],
    });
  });

  it("암행어사 catches only 13·18광땡", () => {
    expect(resolve([hand("a", S(1), S(3)), hand("b", S(4), S(7))])).toEqual({ type: "win", winners: ["b"] });
    expect(resolve([hand("a", S(3), S(8)), hand("b", S(4), S(7))])).toEqual({ type: "win", winners: ["a"] });
  });

  it("땡잡이 does not catch 장땡 and ties 망통 otherwise", () => {
    expect(resolve([hand("a", S(10), N(10)), hand("b", S(3), S(7))])).toEqual({ type: "win", winners: ["a"] });
    expect(resolve([hand("a", N(2), N(8)), hand("b", S(3), S(7))])).toMatchObject({ type: "rematch", reason: "동점" });
  });

  it("구사 forces a rematch against 알리 or lower, not against 땡", () => {
    expect(resolve([hand("a", N(4), N(9)), hand("b", N(1), N(2))])).toEqual({
      type: "rematch",
      participants: ["a", "b"],
      reason: "구사",
    });
    expect(resolve([hand("a", N(4), N(9)), hand("b", S(1), N(1))])).toEqual({ type: "win", winners: ["b"] });
  });

  it("멍텅구리 구사 forces a rematch up to 9땡 but loses to 장땡 and 광땡", () => {
    expect(resolve([hand("a", S(4), S(9)), hand("b", S(9 - 1), N(9 - 1))])).toMatchObject({ type: "rematch" });
    expect(resolve([hand("a", S(4), S(9)), hand("b", S(10), N(10))])).toEqual({ type: "win", winners: ["b"] });
    expect(resolve([hand("a", S(4), S(9)), hand("b", S(1), S(3))])).toEqual({ type: "win", winners: ["b"] });
  });

  it("includes every candidate in a 구사 rematch and only the tied leaders in a tie rematch", () => {
    expect(resolve([hand("a", N(4), N(9)), hand("b", N(2), N(3)), hand("c", N(2), N(6))])).toEqual({
      type: "rematch",
      participants: ["a", "b", "c"],
      reason: "구사",
    });
    expect(resolve([hand("a", S(2), N(3)), hand("b", S(6), N(9)), hand("c", N(2), N(8))])).toEqual({
      type: "rematch",
      participants: ["a", "b"],
      reason: "동점",
    });
  });
});
