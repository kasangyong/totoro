import { describe, expect, it } from "vitest";
import { replay } from "./replay";
import { maskCards, stripSecrets } from "./view";

describe("view", () => {
  const cards = [
    { ownerId: "a", faceUp: false, card: 1 },
    { ownerId: "a", faceUp: true, card: 2 },
    { ownerId: "b", faceUp: false, card: 3 },
  ];

  it("shows own hidden cards and everyone's face-up cards only", () => {
    expect(maskCards(cards, "a").map((c) => c.card)).toEqual([1, 2, null]);
    expect(maskCards(cards, "b").map((c) => c.card)).toEqual([null, 2, 3]);
  });

  it("shows spectators face-up cards only", () => {
    expect(maskCards(cards, null).map((c) => c.card)).toEqual([null, 2, null]);
  });

  it("removes secrets", () => {
    const viewed = stripSecrets({ seq: 1, secrets: { serverSeed: "x" } });
    expect(viewed).toEqual({ seq: 1 });
    expect(JSON.stringify(viewed)).not.toContain("serverSeed");
  });
});

describe("replay", () => {
  it("folds the action log through the reducer", () => {
    expect(replay(0, (s: number, a: number) => s * 10 + a, [1, 2, 3])).toBe(123);
  });
});
