// 방 서비스가 게임 종류와 상관없이 쓰는 얇은 연결부. 규칙은 전부 lib/engine에 있다.
import type { SeedEntry } from "../engine/rng";
import {
  createPoker7Hand,
  reducePoker7,
  viewPoker7,
  type Poker7Action,
  type Poker7State,
  type Poker7View,
} from "../engine/poker7/game";
import { createSutdaHand, reduceSutda, viewSutda, type SutdaAction, type SutdaState, type SutdaView } from "../engine/sutda/game";

export const GAME_KINDS = ["sutda", "poker7"] as const;
export type GameKind = (typeof GAME_KINDS)[number];

export type GameState = SutdaState | Poker7State;
export type GameAction = SutdaAction | Poker7Action;
export type GameView = SutdaView | Poker7View;

export type CreateGame = {
  handId: string;
  baseBet: number;
  bossId: string;
  seats: { id: string; seatNo: number; stack: number }[];
  serverSeed: string;
  seeds: SeedEntry[];
};

export function createGame(kind: GameKind, p: CreateGame): GameState {
  if (kind === "sutda") return createSutdaHand(p);
  // 7포커는 판마다 오픈 카드로 보스를 정하므로 방의 보스를 쓰지 않는다.
  return createPoker7Hand({ handId: p.handId, baseBet: p.baseBet, seats: p.seats, serverSeed: p.serverSeed, seeds: p.seeds });
}

/** action은 서비스가 게임 종류에 맞게 만든다 (섯다 전용·포커 전용 액션은 각 API에서만 생성) */
export function reduceGame(state: GameState, action: GameAction): GameState {
  return state.game === "sutda" ? reduceSutda(state, action as SutdaAction) : reducePoker7(state, action as Poker7Action);
}

export function viewGame(state: GameState, viewerId: string | null): GameView {
  return state.game === "sutda" ? viewSutda(state, viewerId) : viewPoker7(state, viewerId);
}

/** 지금 무엇을 기다리는지 → 기한 길이와 시간 초과 액션이 정해진다 */
export type WaitKind = "turn" | "rejoin" | "choice";

export function waitKind(state: GameState): WaitKind {
  if (state.game === "sutda" && state.phase === "rejoin") return "rejoin";
  if (state.game === "poker7" && state.phase === "choice") return "choice";
  return "turn";
}

export function timeoutAction(state: GameState): GameAction {
  switch (waitKind(state)) {
    case "rejoin":
      return { type: "rejoin_timeout" };
    case "choice":
      return { type: "choice_timeout" };
    case "turn":
      return { type: "timeout", seatId: state.round.toActId! };
  }
}

export function isDone(state: GameState): boolean {
  return state.phase === "done";
}

/** 판 결과 요약 (hands 테이블 result 컬럼) */
export function summarize(state: GameState) {
  const r = state.result!;
  const labels =
    state.game === "sutda"
      ? Object.fromEntries(Object.entries(state.result!.hands).map(([id, h]) => [id, h.label]))
      : Object.fromEntries(Object.entries(state.result!.hands).map(([id, h]) => [id, h.category]));
  return {
    payouts: r.payouts,
    winnerId: r.winnerId,
    hands: labels,
    rematches: state.game === "sutda" ? state.rematchNo : 0,
  };
}
