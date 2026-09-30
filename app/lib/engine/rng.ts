// RNG spec v1 — docs/design/rooms-arch.md 결정 4. 바꾸면 v2로 올리고 테스트 벡터도 새로 만든다.
import { hmac } from "@noble/hashes/hmac.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes, utf8ToBytes } from "@noble/hashes/utils.js";

export const RNG_VERSION = "v1";

const SERVER_SEED_RE = /^[0-9a-f]{64}$/;
const CLIENT_SEED_RE = /^[0-9a-f]{32}$/;
// hand_id·user_id는 uuid 등 ASCII 영숫자와 '-'만 허용 → 메시지 구분자(| , =)와 섞이지 않고 정렬이 언어와 무관.
const ID_RE = /^[A-Za-z0-9-]+$/;
const TWO_32 = 2 ** 32;

export type SeedEntry = { userId: string; clientSeed: string };

export function isValidServerSeed(seed: string): boolean {
  return SERVER_SEED_RE.test(seed);
}

export function isValidClientSeed(seed: string): boolean {
  return CLIENT_SEED_RE.test(seed);
}

export function commitOf(serverSeed: string): string {
  return bytesToHex(sha256(hexToBytes(serverSeed)));
}

export function autoClientSeed(handId: string, userId: string): string {
  return bytesToHex(sha256(utf8ToBytes(`auto|${handId}|${userId}`))).slice(0, 32);
}

export function seedMaterial(seeds: SeedEntry[]): string {
  const seen = new Set<string>();
  for (const s of seeds) {
    if (!ID_RE.test(s.userId)) throw new Error(`invalid user id ${s.userId}`);
    if (seen.has(s.userId)) throw new Error(`duplicate user id ${s.userId}`);
    seen.add(s.userId);
    if (!isValidClientSeed(s.clientSeed)) throw new Error(`invalid client seed for ${s.userId}`);
  }
  return [...seeds]
    .sort((a, b) => (a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0))
    .map((s) => `${s.userId}=${s.clientSeed}`)
    .join(",");
}

export type Rng = {
  nextUint32(): number;
  uniform(n: number): number;
};

export function createRng(params: {
  serverSeed: string;
  handId: string;
  rematchNo: number;
  seeds: SeedEntry[];
}): Rng {
  if (!isValidServerSeed(params.serverSeed)) throw new Error("invalid server seed");
  if (!ID_RE.test(params.handId)) throw new Error("invalid hand id");
  if (!Number.isSafeInteger(params.rematchNo) || params.rematchNo < 0) throw new Error("invalid rematch number");
  const key = hexToBytes(params.serverSeed);
  const prefix = `${RNG_VERSION}|${params.handId}|r${params.rematchNo}|${seedMaterial(params.seeds)}|`;
  let counter = 0;
  let block: Uint8Array = new Uint8Array(0);
  let offset = 32;

  function nextUint32(): number {
    if (offset >= 32) {
      block = hmac(sha256, key, utf8ToBytes(prefix + counter));
      counter += 1;
      offset = 0;
    }
    const b = block;
    const x = ((b[offset] << 24) | (b[offset + 1] << 16) | (b[offset + 2] << 8) | b[offset + 3]) >>> 0;
    offset += 4;
    return x;
  }

  function uniform(n: number): number {
    if (!Number.isInteger(n) || n < 1 || n > TWO_32) throw new Error(`uniform: bad n ${n}`);
    const limit = TWO_32 - (TWO_32 % n);
    for (;;) {
      const x = nextUint32();
      if (x < limit) return x % n;
    }
  }

  return { nextUint32, uniform };
}

export function shuffle<T>(items: readonly T[], rng: Rng): T[] {
  const a = [...items];
  for (let i = a.length - 1; i >= 1; i--) {
    const j = rng.uniform(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
