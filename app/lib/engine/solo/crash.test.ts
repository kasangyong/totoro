import { describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { crashMs, crashMultiplier100, crashPointFromSeed } from "./crash";

describe("crash", () => {
  it("grows like the demo: 2× ≈ 4.6s, 10× ≈ 15s", () => {
    expect(crashMultiplier100(0)).toBe(100);
    expect(crashMultiplier100(4621)).toBe(200);
    expect(crashMultiplier100(4620)).toBe(199);
    expect(crashMultiplier100(15351)).toBe(1000);
  });

  it("crash time is the first ms where the multiplier reaches the crash point", () => {
    for (const p of [100, 101, 150, 200, 777, 1000, 123456, 100_000_000]) {
      const ms = crashMs(p);
      expect(crashMultiplier100(ms)).toBeGreaterThanOrEqual(p);
      if (ms > 0) expect(crashMultiplier100(ms - 1)).toBeLessThan(p);
    }
  });

  it("derives crash points with P(≥x) ≈ 0.99/x (1.00× ≈ 2%: 99/(1−u) < 101)", () => {
    let instant = 0;
    let over2 = 0;
    const n = 20000;
    for (let i = 0; i < n; i++) {
      const p = crashPointFromSeed(randomBytes(32).toString("hex"));
      if (p === 100) instant++;
      if (p >= 200) over2++;
    }
    expect(instant / n).toBeGreaterThan(0.015);
    expect(instant / n).toBeLessThan(0.025);
    expect(over2 / n).toBeGreaterThan(0.48);
    expect(over2 / n).toBeLessThan(0.51);
  });

  it("is deterministic per seed", () => {
    const seed = "11".repeat(32);
    expect(crashPointFromSeed(seed)).toBe(crashPointFromSeed(seed));
  });
});
