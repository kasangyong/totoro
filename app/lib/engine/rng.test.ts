import { describe, expect, it } from "vitest";
import { autoClientSeed, commitOf, createRng, isValidClientSeed, seedMaterial, shuffle } from "./rng";

const VECTOR = {
  serverSeed: "01".repeat(32),
  handId: "h1",
  rematchNo: 0,
  seeds: [
    { userId: "b", clientSeed: "ff".repeat(16) },
    { userId: "a", clientSeed: "00".repeat(16) },
  ],
};

describe("rng spec v1", () => {
  it("matches the documented test vector", () => {
    expect(seedMaterial(VECTOR.seeds)).toBe(
      "a=00000000000000000000000000000000,b=ffffffffffffffffffffffffffffffff",
    );
    const rng = createRng(VECTOR);
    expect([rng.nextUint32(), rng.nextUint32(), rng.nextUint32(), rng.nextUint32()]).toEqual([
      1333967691, 654985159, 3615548580, 2286357061,
    ]);
    const deck = shuffle(
      Array.from({ length: 20 }, (_, i) => i),
      createRng(VECTOR),
    );
    expect(deck).toEqual([8, 19, 15, 3, 6, 4, 13, 9, 7, 17, 16, 10, 5, 18, 1, 12, 14, 0, 2, 11]);
  });

  it("separates rematch domains", () => {
    const a = shuffle([...Array(20).keys()], createRng(VECTOR));
    const b = shuffle([...Array(20).keys()], createRng({ ...VECTOR, rematchNo: 1 }));
    expect(a).not.toEqual(b);
  });

  it("rejects malformed client seeds that could corrupt seed material", () => {
    expect(isValidClientSeed("ab".repeat(16))).toBe(true);
    expect(isValidClientSeed("AB".repeat(16))).toBe(false);
    expect(() => seedMaterial([{ userId: "a", clientSeed: "00,b=ff" }])).toThrow();
    expect(() => createRng({ ...VECTOR, serverSeed: "zz" })).toThrow();
  });

  it("derives auto seeds and commits exactly (fixed vectors)", () => {
    expect(autoClientSeed("h1", "u1")).toBe("f7e62a62cc658d56001b25a3e891ddfc");
    expect(commitOf("01".repeat(32))).toBe("72cd6e8422c407fb6d098690f1130b7ded7ec2f7f5e1d30bd9d521f015363793");
  });

  it("moves to the next HMAC block after 8 uint32 values", () => {
    const rng = createRng(VECTOR);
    const values = Array.from({ length: 9 }, () => rng.nextUint32());
    expect(values[7]).toBe(2109767574);
    expect(values[8]).toBe(3787062226);
  });

  it("rejects ids and rematch numbers that would make the message ambiguous", () => {
    expect(() => seedMaterial([{ userId: "a|b", clientSeed: "00".repeat(16) }])).toThrow();
    expect(() =>
      seedMaterial([
        { userId: "a", clientSeed: "00".repeat(16) },
        { userId: "a", clientSeed: "ff".repeat(16) },
      ]),
    ).toThrow();
    expect(() => createRng({ ...VECTOR, handId: "h|1" })).toThrow();
    expect(() => createRng({ ...VECTOR, rematchNo: -1 })).toThrow();
    expect(() => createRng({ ...VECTOR, rematchNo: 1.5 })).toThrow();
  });

  it("uniform stays in range and is roughly flat", () => {
    const rng = createRng(VECTOR);
    const counts = new Array(6).fill(0);
    for (let i = 0; i < 60000; i++) counts[rng.uniform(6)]++;
    for (const c of counts) expect(Math.abs(c - 10000)).toBeLessThan(500);
  });

  it("shuffle is a permutation and deterministic", () => {
    const deck = [...Array(52).keys()];
    const s1 = shuffle(deck, createRng(VECTOR));
    const s2 = shuffle(deck, createRng(VECTOR));
    expect(s1).toEqual(s2);
    expect([...s1].sort((x, y) => x - y)).toEqual(deck);
  });
});
