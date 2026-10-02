import { describe, expect, it } from "vitest";
import { CATEGORIES } from "@/lib/engine/poker7/hands";
import { pokerPosition, SUTDA_ROWS, sutdaPosition } from "./hand-ranks";

describe("족보 패널", () => {
  it("highlights a row for every 섯다 two-card hand", () => {
    for (let a = 0; a < 20; a++) {
      for (let b = a + 1; b < 20; b++) {
        expect(SUTDA_ROWS).toContain(sutdaPosition([a, b])!.row);
      }
    }
    expect(sutdaPosition([0])).toBeNull();
    expect(sutdaPosition([6, 12])).toEqual({ row: "1끗", special: "암행어사" });
  });

  it("highlights the current 7포커 category from 1 to 7 cards", () => {
    const c = (suit: number, rank: number) => suit * 13 + rank - 2;
    expect(pokerPosition([c(0, 14), c(1, 14)])).toBe("원페어");
    expect(pokerPosition([c(0, 10), c(0, 11), c(0, 12), c(0, 13), c(0, 14)])).toBe("로열 스트레이트 플러시");
    expect(CATEGORIES).toContain(pokerPosition([c(0, 2), c(1, 5), c(2, 9)]));
  });
});

describe("족보 패널 (3장 섯다)", () => {
  const S = (m: number) => (m - 1) * 2;
  const N = (m: number) => (m - 1) * 2 + 1;
  it("shows the best ordinary combo of three cards and marks special hands that are possible", () => {
    // 3광·7열끗·10일반: 최고는 7·10(7끗), 땡잡이(3광·7열끗)는 "가능"
    expect(sutdaPosition([S(3), S(7), N(10)])).toEqual({ row: "7끗", special: null, best: true, possible: ["땡잡이"] });
    // 4열끗·9열끗·4일반: 4땡이 최고, 멍텅구리구사·구사 가능
    const p = sutdaPosition([S(4), S(9), N(4)])!;
    expect(p.row).toBe("4땡");
    expect(p.possible).toEqual(["구사", "멍텅구리구사"]);
  });
});
