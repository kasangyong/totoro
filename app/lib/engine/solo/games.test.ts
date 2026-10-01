import { describe, expect, it } from "vitest";
import {
  CHICKEN,
  PLINKO,
  WHEEL,
  chickenDeathLane,
  chickenMult100,
  crashPoint100,
  fractionMult100,
  hiloHit,
  hiloOdds,
  hiloStep,
  minesBoard,
  minesMult100,
  playDice,
  playLimbo,
  playPlinko,
  playWheel,
  soloRng,
  type ChickenDifficulty,
} from "./games";

const rng = (nonce = 0) =>
  soloRng({ serverSeed: "ab".repeat(32), clientSeed: "cd".repeat(16), userId: "u-1", nonce });

describe("expected return is 99% (exact or binomial)", () => {
  it("wheel tables average exactly 0.99×", () => {
    for (const seg of [10, 20, 30] as const) {
      for (const risk of ["low", "med", "high"] as const) {
        const t = WHEEL[seg][risk];
        expect(t).toHaveLength(seg);
        expect(t.reduce((a, b) => a + b, 0) / seg).toBe(99);
      }
    }
  });

  it("plinko tables return 98.9~99.1% under the binomial distribution", () => {
    const choose = (n: number, k: number): number => (k === 0 || k === n ? 1 : choose(n - 1, k - 1) + choose(n - 1, k));
    for (const rows of [8, 12, 16] as const) {
      for (const risk of ["low", "med", "high"] as const) {
        const t = PLINKO[rows][risk];
        expect(t).toHaveLength(rows + 1);
        const ev = t.reduce((a, m, k) => a + (m * choose(rows, k)) / 2 ** rows, 0) / 100;
        expect(ev).toBeGreaterThan(0.989);
        expect(ev).toBeLessThan(0.992); // HANDOFF 표 중 99.1%를 살짝 넘는 것이 하나 있음 (≈99.12%)
      }
    }
  });

  it("dice pays 99/chance on a win", () => {
    for (const target of [2, 50, 98]) {
      let ev = 0;
      // 모든 roll(0~10000)을 직접 대입
      const fake = (roll: number) => ({ nextUint32: () => 0, uniform: () => roll });
      for (let roll = 0; roll <= 10000; roll++) ev += playDice(fake(roll), 100, { mode: "under", target }).payout;
      expect(ev / 10001 / 100).toBeGreaterThan(0.985);
      expect(ev / 10001 / 100).toBeLessThan(0.995);
    }
  });

  it("limbo and crash share P(result ≥ x) ≈ 0.99 / x, with ~1% instant 1.00×", () => {
    expect(crashPoint100(0)).toBe(100);
    expect(crashPoint100(2 ** 32 / 100 - 1)).toBe(100);
    expect(crashPoint100(2 ** 32 - 1)).toBe(100_000_000);
    const r = rng();
    let wins = 0;
    const n = 50000;
    for (let i = 0; i < n; i++) if (playLimbo(r, 100, { target100: 200 }).win) wins++;
    expect(wins / n).toBeGreaterThan(0.48);
    expect(wins / n).toBeLessThan(0.51);
  });

  it("mines multiplier × survival probability ≤ 0.99 and close to it", () => {
    for (const k of [1, 3, 12, 24]) {
      for (let found = 1; found <= 25 - k; found++) {
        let survive = 1;
        for (let i = 0; i < found; i++) survive *= (25 - k - i) / (25 - i);
        const ev = (minesMult100(k, found) / 100) * survive;
        expect(ev).toBeLessThanOrEqual(0.99 + 1e-9);
        expect(ev).toBeGreaterThan(0.97);
      }
    }
    expect(minesMult100(1, 1)).toBe(103); // 0.99 × 25/24 = 1.03125
  });

  it("chicken multiplier matches the documented table", () => {
    expect(chickenMult100("easy", 1)).toBe(107);
    expect(chickenMult100("medium", 1)).toBe(117);
    expect(chickenMult100("hard", 1)).toBe(130);
    expect(chickenMult100("hell", 1)).toBe(165);
    expect(Math.round(chickenMult100("hell", 15) / 100)).toBe(2106); // 문서 ≈2,100×
    for (const d of Object.keys(CHICKEN) as ChickenDifficulty[]) {
      const { lanes, survive } = CHICKEN[d];
      for (let n = 1; n <= lanes; n++) {
        const ev = (chickenMult100(d, n) / 100) * (survive / 100) ** n;
        expect(ev).toBeLessThanOrEqual(0.99 + 1e-9);
        expect(ev).toBeGreaterThan(0.97);
      }
    }
  });
});

describe("rules", () => {
  it("dice over/under boundaries", () => {
    const at = (roll: number) => ({ nextUint32: () => 0, uniform: () => roll });
    expect(playDice(at(4999), 100, { mode: "under", target: 50 }).win).toBe(true);
    expect(playDice(at(5000), 100, { mode: "under", target: 50 }).win).toBe(false);
    expect(playDice(at(5001), 100, { mode: "over", target: 50 }).win).toBe(true);
    expect(playDice(at(5000), 100, { mode: "over", target: 50 }).win).toBe(false);
    expect(playDice(at(0), 100, { mode: "under", target: 50 }).payout).toBe(198);
    expect(() => playDice(at(0), 100, { mode: "under", target: 99 })).toThrow();
  });

  it("plinko path decides the slot", () => {
    const r = playPlinko(rng(3), 1000, { rows: 16, risk: "high" });
    expect(r.path).toHaveLength(16);
    expect(r.slot).toBe(r.path.filter((x) => x === 1).length);
    expect(r.payout).toBe(Math.floor((1000 * PLINKO[16].high[r.slot]) / 100));
  });

  it("wheel lands on a segment of the chosen table", () => {
    const r = playWheel(rng(4), 100, { risk: "high", segments: 30 });
    expect(r.index).toBeGreaterThanOrEqual(0);
    expect(r.index).toBeLessThan(30);
    expect(r.mult100).toBe(WHEEL[30].high[r.index]);
  });

  it("mines board has k distinct tiles and is deterministic", () => {
    const a = minesBoard(rng(5), 5);
    expect(new Set(a).size).toBe(5);
    expect(minesBoard(rng(5), 5)).toEqual(a);
    expect(minesBoard(rng(6), 5)).not.toEqual(a);
  });

  it("chicken death lane is within range and roughly matches survival odds", () => {
    let survivedFirst = 0;
    for (let i = 0; i < 4000; i++) {
      const lane = chickenDeathLane(rng(i), "hell");
      expect(lane).toBeGreaterThanOrEqual(1);
      expect(lane).toBeLessThanOrEqual(16);
      if (lane > 1) survivedFirst++;
    }
    expect(survivedFirst / 4000).toBeGreaterThan(0.56);
    expect(survivedFirst / 4000).toBeLessThan(0.64);
  });

  it("hilo odds, hits and accumulated multiplier", () => {
    expect(hiloOdds(1, "hi")).toBe(12);
    expect(hiloOdds(1, "lo")).toBeNull();
    expect(hiloOdds(13, "lo")).toBe(12);
    expect(hiloOdds(7, "hi")).toBe(7);
    expect(hiloOdds(7, "lo")).toBe(7);
    expect(hiloOdds(7, "same")).toBeNull();
    expect(hiloHit(7, "hi", 7)).toBe(true);
    expect(hiloHit(1, "hi", 1)).toBe(false);
    expect(hiloHit(13, "same", 13)).toBe(true);
    let acc = { num: "1", den: "1" };
    acc = hiloStep(acc, 7); // 0.99 × 13/7 = 1.8385…
    expect(fractionMult100(acc)).toBe(183);
    acc = hiloStep(acc, 12);
    expect(fractionMult100(acc)).toBe(Math.floor(100 * 0.99 * (13 / 7) * 0.99 * (13 / 12)));
  });
});
