// 공정성 페이지의 재계산: 공개된 서버 시드로 그 판 전체(결과·승패·배율·지급)를 다시 만들어 기록과 비교한다.
import { commitOf } from "../rng";
import { crashPointFromSeed } from "./crash";
import {
  chickenDeathLane,
  chickenMult100,
  fractionMult100,
  hiloCards,
  hiloHit,
  hiloOdds,
  hiloStep,
  HILO_MAX_CARDS,
  minesBoard,
  minesMult100,
  payoutOf,
  playDice,
  playLimbo,
  playPlinko,
  playWheel,
  soloRng,
  type ChickenDifficulty,
  type Fraction,
  type HiloCard,
  type HiloGuess,
} from "./games";

export type RecordedBet = {
  game: string;
  nonce: number;
  stake: number;
  payout: number | null;
  params: Record<string, unknown>;
  state: Record<string, unknown>;
  status: string;
};

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export function verifySoloBet(bet: RecordedBet, seed: { serverSeed: string; clientSeed: string; userId: string }): boolean {
  const rng = soloRng({ ...seed, nonce: bet.nonce });
  const s = bet.state;
  const p = bet.params as never;
  const instant = (r: Record<string, unknown>) => Object.keys(r).every((k) => same(r[k], s[k])) && r.payout === bet.payout;
  switch (bet.game) {
    case "dice":
      return instant(playDice(rng, bet.stake, p));
    case "limbo":
      return instant(playLimbo(rng, bet.stake, p));
    case "wheel":
      return instant(playWheel(rng, bet.stake, p));
    case "plinko":
      return instant(playPlinko(rng, bet.stake, p));
    case "mines": {
      const mines = (bet.params as { mines: number }).mines;
      const board = minesBoard(rng, mines);
      const revealed = s.revealed as number[];
      if (!same(board, s.board)) return false;
      if (bet.status === "lost") {
        // 마지막에 연 칸만 지뢰, 그 전은 모두 보석
        return board.includes(revealed[revealed.length - 1]) && revealed.slice(0, -1).every((t) => !board.includes(t)) && bet.payout === 0;
      }
      return revealed.every((t) => !board.includes(t)) && bet.payout === payoutOf(bet.stake, minesMult100(mines, revealed.length));
    }
    case "chicken": {
      const d = (bet.params as { difficulty: ChickenDifficulty }).difficulty;
      const lane = chickenDeathLane(rng, d);
      const crossed = s.crossed as number;
      if (lane !== s.deathLane) return false;
      if (bet.status === "lost") return crossed + 1 === lane && bet.payout === 0;
      return crossed < lane && bet.payout === payoutOf(bet.stake, chickenMult100(d, crossed));
    }
    case "hilo": {
      const cards = hiloCards(rng);
      const history = s.history as { card: HiloCard; guess: HiloGuess | "skip"; hit: boolean | null }[];
      let acc: Fraction = { num: "1", den: "1" };
      for (const [i, h] of history.entries()) {
        if (!same(h.card, cards[i])) return false;
        if (h.guess === "skip") continue;
        const odds = hiloOdds(h.card.rank, h.guess);
        if (odds === null || h.hit !== hiloHit(h.card.rank, h.guess, cards[i + 1].rank)) return false;
        // 틀리면 그 자리에서 판이 끝나므로, 마지막이 아닌 판정은 모두 적중이어야 한다
        if (!h.hit && i !== history.length - 1) return false;
        if (h.hit) acc = hiloStep(acc, odds);
      }
      if (!same(s.current, cards[history.length])) return false;
      if (bet.status === "lost") return bet.payout === 0 && history[history.length - 1]?.hit === false;
      const correct = history.filter((h) => h.hit).length;
      // 카드를 다 써서 끝났는데 맞힌 게 없으면 베팅액 그대로
      if (correct === 0 && history.length !== HILO_MAX_CARDS - 1) return false;
      const expected = correct === 0 ? bet.stake : payoutOf(bet.stake, fractionMult100(acc));
      return bet.payout === expected;
    }
  }
  return false;
}

/** Crash 라운드: 커밋 = SHA-256(시드), 시드로 터지는 배율 재계산 */
export function verifyCrashRound(r: { commit: string; seed: string; crashPoint100: number }): boolean {
  return commitOf(r.seed) === r.commit && crashPointFromSeed(r.seed) === r.crashPoint100;
}
