// Crash — 모두가 같은 판. 라운드마다 서버 시드를 만들고 해시를 먼저 공개(커밋)한 뒤, 터지면 시드를 공개한다.
// 배율 m(t) = floor(100 × e^(0.00015 × t_ms)) / 100 (2×≈4.6초, 10×≈15초 — crash-demo.html과 같음)
import { hmac } from "@noble/hashes/hmac.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { hexToBytes, utf8ToBytes } from "@noble/hashes/utils.js";
import { crashPoint100 } from "./games";

export const CRASH_GROWTH = 0.00015;
export const CRASH_BETTING_MS = 5_000;
export const CRASH_AFTER_MS = 3_000;

export function crashMultiplier100(ms: number): number {
  if (ms <= 0) return 100;
  return Math.floor(100 * Math.exp(CRASH_GROWTH * ms));
}

/** m(ms) ≥ 터지는 배율이 되는 가장 이른 ms (같은 함수로 계산해 경계 오차가 없다) */
export function crashMs(point100: number): number {
  if (point100 <= 100) return 0;
  let ms = Math.max(0, Math.floor(Math.log(point100 / 100) / CRASH_GROWTH) - 2);
  while (crashMultiplier100(ms) < point100) ms++;
  return ms;
}

/** 라운드 시드 → 터지는 배율. 커밋(SHA-256(seed))과 다른 값에서 뽑아야 커밋만 보고 결과를 알 수 없다. */
export function crashPointFromSeed(seedHex: string): number {
  const b = hmac(sha256, hexToBytes(seedHex), utf8ToBytes("crash-v1"));
  const x = ((b[0] << 24) | (b[1] << 16) | (b[2] << 8) | b[3]) >>> 0;
  return crashPoint100(x);
}
