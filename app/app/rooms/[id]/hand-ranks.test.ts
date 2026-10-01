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
