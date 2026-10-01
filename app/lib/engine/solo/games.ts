// 혼자 하는 게임 판정 — HANDOFF.md §4의 수식 그대로, 정수 연산으로.
// 배율은 100배 정수(2.50× = 250). 지급 = floor(베팅 × 배율 / 100).
import { createRng, shuffle, type Rng } from "../rng";

export const MIN_BET = 10;
/** [우리 규칙] 한 판 최대 베팅과 최대 배율 (10,000,000×) — 지급액이 Number 안전 범위(2^53)를 넘지 않게 */
export const MAX_BET = 1_000_000;
export const MAX_MULT100 = 1_000_000_000;

/** 한 판(또는 한 세션)의 난수: 사용자 시드 쌍 + nonce. 규격은 rooms-arch 결정 4의 RNG v1 */
export function soloRng(p: { serverSeed: string; clientSeed: string; userId: string; nonce: number }): Rng {
  return createRng({
    serverSeed: p.serverSeed,
    handId: `solo-${p.nonce}`,
    rematchNo: 0,
    seeds: [{ userId: p.userId, clientSeed: p.clientSeed }],
  });
}

export const payoutOf = (bet: number, mult100: number) => Math.floor((bet * Math.min(mult100, MAX_MULT100)) / 100);

const TWO_32 = 2 ** 32;
/** Crash·Limbo 공통 분포: floor(99 / (1 − u)) / 100, u = x / 2^32, 1.00× ~ 1,000,000× */
export function crashPoint100(x: number): number {
  const v = Math.floor((99 * TWO_32) / (TWO_32 - x));
  return Math.max(100, Math.min(100_000_000, v));
}

// ── Dice ──────────────────────────────────────────────
export type DiceParams = { mode: "under" | "over"; target: number };
export function playDice(rng: Rng, bet: number, p: DiceParams) {
  if (!Number.isInteger(p.target) || p.target < 2 || p.target > 98) throw new Error("dice target 2~98");
  if (p.mode !== "under" && p.mode !== "over") throw new Error("dice mode");
  const roll = rng.uniform(10001); // 0.00 ~ 100.00 (100배 정수)
  const chance = p.mode === "under" ? p.target : 100 - p.target;
  const win = p.mode === "under" ? roll < p.target * 100 : roll > p.target * 100;
  const mult100 = Math.floor(9900 / chance);
  // 지급은 99/확률을 바로 곱한 값 (배율 표시는 소수 둘째 자리 내림이라 1P 안팎 차이가 날 수 있다)
  return { roll, win, mult100: win ? mult100 : 0, payout: win ? Math.floor((bet * 99) / chance) : 0 };
}

// ── Limbo ─────────────────────────────────────────────
export type LimboParams = { target100: number };
export function playLimbo(rng: Rng, bet: number, p: LimboParams) {
  if (!Number.isInteger(p.target100) || p.target100 < 101 || p.target100 > 100_000_000) throw new Error("limbo target");
  const result100 = crashPoint100(rng.nextUint32());
  const win = result100 >= p.target100;
  return { result100, win, mult100: win ? p.target100 : 0, payout: win ? payoutOf(bet, p.target100) : 0 };
}

// ── Wheel ─────────────────────────────────────────────
export type WheelRisk = "low" | "med" | "high";
export type WheelParams = { risk: WheelRisk; segments: 10 | 20 | 30 };
const LOW10 = [150, 120, 120, 120, 0, 120, 120, 120, 120, 0];
const MED30 = [150, 200, 150, 200, 170, 200, 200, 350, 200, 200, 150, 200, 200, 200, 200];
export const WHEEL: Record<10 | 20 | 30, Record<WheelRisk, number[]>> = {
  10: { low: LOW10, med: [0, 190, 0, 150, 0, 200, 0, 150, 0, 300], high: highWheel(10) },
  20: {
    low: [...LOW10, ...LOW10],
    med: [150, 0, 200, 0, 200, 0, 200, 0, 150, 0, 300, 0, 180, 0, 200, 0, 200, 0, 200, 0],
    high: highWheel(20),
  },
  30: { low: [...LOW10, ...LOW10, ...LOW10], med: MED30.flatMap((m) => [m, 0]), high: highWheel(30) },
};
function highWheel(n: number): number[] {
  return Array.from({ length: n }, (_, i) => (i === n - 1 ? 99 * n : 0));
}
export function playWheel(rng: Rng, bet: number, p: WheelParams) {
  const table = WHEEL[p.segments]?.[p.risk];
  if (!table) throw new Error("wheel params");
  const index = rng.uniform(table.length);
  const mult100 = table[index];
  return { index, win: mult100 > 0, mult100, payout: payoutOf(bet, mult100) };
}

// ── Plinko ────────────────────────────────────────────
export type PlinkoParams = { rows: 8 | 12 | 16; risk: WheelRisk };
const P = (s: string) => s.split(",").map((x) => Math.round(Number(x) * 100));
export const PLINKO: Record<8 | 12 | 16, Record<WheelRisk, number[]>> = {
  8: { low: P("5.6,2.1,1.1,1,0.5,1,1.1,2.1,5.6"), med: P("13,3,1.3,0.7,0.4,0.7,1.3,3,13"), high: P("29,4,1.5,0.3,0.2,0.3,1.5,4,29") },
  12: {
    low: P("10,3,1.6,1.4,1.1,1,0.5,1,1.1,1.4,1.6,3,10"),
    med: P("33,11,4,2,1.1,0.6,0.3,0.6,1.1,2,4,11,33"),
    high: P("170,24,8.1,2,0.7,0.2,0.2,0.2,0.7,2,8.1,24,170"),
  },
  16: {
    low: P("16,9,2,1.4,1.4,1.2,1.1,1,0.5,1,1.1,1.2,1.4,1.4,2,9,16"),
    med: P("110,41,10,5,3,1.5,1,0.5,0.3,0.5,1,1.5,3,5,10,41,110"),
    high: P("1000,130,26,9,4,2,0.2,0.2,0.2,0.2,0.2,2,4,9,26,130,1000"),
  },
};
export function playPlinko(rng: Rng, bet: number, p: PlinkoParams) {
  const table = PLINKO[p.rows]?.[p.risk];
  if (!table) throw new Error("plinko params");
  const path = Array.from({ length: p.rows }, () => rng.uniform(2)); // 0 왼쪽, 1 오른쪽
  const slot = path.reduce((a, b) => a + b, 0);
  const mult100 = table[slot];
  return { path, slot, win: mult100 >= 100, mult100, payout: payoutOf(bet, mult100) };
}

// ── Mines (세션형) ─────────────────────────────────────
export function minesBoard(rng: Rng, mines: number): number[] {
  if (!Number.isInteger(mines) || mines < 1 || mines > 24) throw new Error("mines 1~24");
  return shuffle([...Array(25).keys()], rng).slice(0, mines).sort((a, b) => a - b);
}
/** 보석 n개 찾았을 때 배율: floor(0.99 × Π (25−i)/(25−k−i) × 100) */
export function minesMult100(mines: number, found: number): number {
  if (found === 0) return 100;
  let num = 99n;
  let den = 1n;
  for (let i = 0; i < found; i++) {
    num *= BigInt(25 - i);
    den *= BigInt(25 - mines - i);
  }
  return Number(num / den);
}

// ── 치킨 크로싱 (세션형) ───────────────────────────────
export type ChickenDifficulty = "easy" | "medium" | "hard" | "hell";
export const CHICKEN: Record<ChickenDifficulty, { lanes: number; survive: number }> = {
  easy: { lanes: 24, survive: 92 },
  medium: { lanes: 22, survive: 84 },
  hard: { lanes: 20, survive: 76 },
  hell: { lanes: 15, survive: 60 },
};
/** 몇 번째 차선(1부터)에서 치이는지. 끝까지 살면 lanes + 1. 판 시작 때 정해 둔다. */
export function chickenDeathLane(rng: Rng, d: ChickenDifficulty): number {
  const { lanes, survive } = CHICKEN[d];
  for (let lane = 1; lane <= lanes; lane++) if (rng.uniform(100) >= survive) return lane;
  return lanes + 1;
}
/** n칸 건넜을 때 배율: floor(0.99 / p^n × 100) */
export function chickenMult100(d: ChickenDifficulty, crossed: number): number {
  const p = BigInt(CHICKEN[d].survive);
  return Number((99n * 100n ** BigInt(crossed)) / p ** BigInt(crossed));
}

// ── HiLo (세션형) ─────────────────────────────────────
/** 카드: 숫자 1(A)~13(K) + 무늬 0~3. 덱이 줄지 않으므로 매 장 13가지 균등. */
export type HiloCard = { rank: number; suit: number };
export const HILO_MAX_CARDS = 200;
export function hiloCards(rng: Rng): HiloCard[] {
  return Array.from({ length: HILO_MAX_CARDS }, () => ({ rank: rng.uniform(13) + 1, suit: rng.uniform(4) }));
}
export type HiloGuess = "hi" | "lo" | "same";
/** 고른 선택지의 적중 칸 수 (13칸 중) — 없는 선택지면 null */
export function hiloOdds(rank: number, guess: HiloGuess): number | null {
  if (rank === 1) return guess === "hi" ? 12 : guess === "same" ? 1 : null;
  if (rank === 13) return guess === "lo" ? 12 : guess === "same" ? 1 : null;
  if (guess === "hi") return 14 - rank; // 높거나 같음
  if (guess === "lo") return rank; // 낮거나 같음
  return null;
}
export function hiloHit(rank: number, guess: HiloGuess, next: number): boolean {
  if (rank === 1 && guess === "hi") return next > 1;
  if (rank === 13 && guess === "lo") return next < 13;
  if (guess === "same") return next === rank;
  return guess === "hi" ? next >= rank : next <= rank;
}
/** 누적 배율 = Π 0.99 × 13 / 칸 수. 분수로 들고 다니다 표시할 때만 내림 */
export type Fraction = { num: string; den: string };
export function hiloStep(acc: Fraction, odds: number): Fraction {
  return { num: String(BigInt(acc.num) * 99n * 13n), den: String(BigInt(acc.den) * 100n * BigInt(odds)) };
}
export const fractionMult100 = (f: Fraction) => {
  const v = (BigInt(f.num) * 100n) / BigInt(f.den);
  return v > BigInt(MAX_MULT100) ? MAX_MULT100 : Number(v);
};
