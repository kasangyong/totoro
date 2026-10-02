// 방 서비스가 게임 종류와 상관없이 쓰는 얇은 연결부. 규칙은 전부 lib/engine에 있다.
import { legalActions, type BetActionType } from "../engine/betting";
import {
  createBlackjackHand,
  legalBlackjack,
  reduceBlackjack,
  viewBlackjack,
  type BjMove,
  type BlackjackAction,
  type BlackjackState,
  type BlackjackView,
} from "../engine/blackjack/game";
import { handTotal } from "../engine/blackjack/hands";
import {
  createHoldemHand,
  legalHoldem,
  reduceHoldem,
  viewHoldem,
  type HoldemAction,
  type HoldemMove,
  type HoldemState,
  type HoldemView,
} from "../engine/holdem/game";
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

export const GAME_KINDS = ["sutda", "sutda3", "poker7", "blackjack", "holdem"] as const;
export type GameKind = (typeof GAME_KINDS)[number];

export type GameState = SutdaState | Poker7State | BlackjackState | HoldemState;
export type GameAction = SutdaAction | Poker7Action | BlackjackAction | HoldemAction;
export type GameView = SutdaView | Poker7View | BlackjackView | HoldemView;
/** 상태 응답의 legal: 섯다·포커 베팅 액션, 블랙잭 베팅·수, 홀덤 수 (홀덤 fold는 섯다·포커 die와 별개 값) */
export type LegalAction = BetActionType | "bet" | "sit_out" | BjMove | HoldemMove;

export type CreateGame = {
  handId: string;
  baseBet: number;
  bossId: string;
  seats: { id: string; seatNo: number; stack: number }[];
  serverSeed: string;
  seeds: SeedEntry[];
};

export function createGame(kind: GameKind, p: CreateGame): GameState {
  const { bossId, ...rest } = p;
  switch (kind) {
    case "sutda":
      return createSutdaHand(p);
    case "sutda3":
      return createSutdaHand({ ...p, variant: 3 });
    case "poker7":
      // 7포커는 판마다 오픈 카드로 보스를 정하므로 방의 보스를 쓰지 않는다.
      void bossId;
      return createPoker7Hand(rest);
    case "blackjack":
      return createBlackjackHand(rest);
    case "holdem":
      // 홀덤은 bossId = 이번 판 버튼 (서비스가 좌석 번호로 돌린다)
      return createHoldemHand(p);
  }
}

/** action은 서비스가 게임 종류에 맞게 만든다 (게임 전용 액션은 각 API에서만 생성) */
export function reduceGame(state: GameState, action: GameAction): GameState {
  switch (state.game) {
    case "sutda":
      return reduceSutda(state, action as SutdaAction);
    case "poker7":
      return reducePoker7(state, action as Poker7Action);
    case "blackjack":
      return reduceBlackjack(state, action as BlackjackAction);
    case "holdem":
      return reduceHoldem(state, action as HoldemAction);
  }
}

export function viewGame(state: GameState, viewerId: string | null): GameView {
  switch (state.game) {
    case "sutda":
      return viewSutda(state, viewerId);
    case "poker7":
      return viewPoker7(state, viewerId);
    case "blackjack":
      return viewBlackjack(state);
    case "holdem":
      return viewHoldem(state, viewerId);
  }
}

/** 지금 차례인 사람 (동시 선택 단계면 null) */
export function currentActor(state: GameState): string | null {
  if (state.phase === "done") return null;
  if (state.game === "blackjack") return state.toAct?.seatId ?? null;
  if (state.game === "holdem") return state.toActId;
  if (state.game === "sutda" && (state.phase === "rejoin" || state.phase === "open" || state.phase === "pick")) return null;
  if (state.game === "poker7" && state.phase === "choice") return null;
  return state.round.toActId;
}

/** 이 사람이 지금 할 수 있는 것 (초이스·재경기 참여는 각 API가 따로 검사) */
export function legalFor(state: GameState, userId: string): LegalAction[] {
  if (state.game === "blackjack") return legalBlackjack(state, userId);
  if (state.game === "holdem") return legalHoldem(state, userId);
  if (currentActor(state) !== userId) return [];
  return legalActions(state.seats, state.round, userId);
}

export function minPlayers(kind: GameKind): number {
  return kind === "blackjack" ? 1 : 2;
}

/** 지금 무엇을 기다리는지 → 기한 길이와 시간 초과 액션이 정해진다 */
// 3장 섯다의 open·pick은 따로 둔다: open 뒤 1차 베팅이 바로 끝나 pick이 와도 기한을 새로 잡게 (sutda3-arch 결정 3)
export type WaitKind = "turn" | "rejoin" | "choice" | "bet" | "open" | "pick";

export function waitKind(state: GameState): WaitKind {
  if (state.game === "sutda" && state.phase === "rejoin") return "rejoin";
  if (state.game === "sutda" && state.phase === "open") return "open";
  if (state.game === "sutda" && state.phase === "pick") return "pick";
  if (state.game === "poker7" && state.phase === "choice") return "choice";
  if (state.game === "blackjack" && state.phase === "bet") return "bet";
  return "turn";
}

export function timeoutAction(state: GameState): GameAction {
  switch (waitKind(state)) {
    case "rejoin":
      return { type: "rejoin_timeout" };
    case "choice":
    case "open":
    case "pick":
      return { type: "choice_timeout" };
    case "bet":
      return { type: "bet_timeout" };
    case "turn":
      return { type: "timeout", seatId: currentActor(state)! };
  }
}

/** 시간 초과 액션으로 대신 처리되는 사람 (판 끝 자동 일어서기 판단용) */
export function timedOutBy(state: GameState, action: GameAction): string[] {
  if (action.type === "timeout") return [action.seatId];
  if (action.type === "choice_timeout" && state.game === "poker7") {
    return state.seats.filter((x) => !state.chosen.includes(x.id)).map((x) => x.id);
  }
  if (action.type === "choice_timeout" && state.game === "sutda") {
    return state.seats
      .filter((x) => state.participants.includes(x.id) && !x.folded && !(state.chosen ?? []).includes(x.id))
      .map((x) => x.id);
  }
  if (action.type === "bet_timeout" && state.game === "blackjack") {
    return state.seats.filter((x) => x.status === "waiting").map((x) => x.id);
  }
  return [];
}

export function isDone(state: GameState): boolean {
  return state.phase === "done";
}

/** 판 결과 요약 (hands 테이블 result 컬럼) */
export function summarize(state: GameState) {
  switch (state.game) {
    case "sutda":
      return {
        payouts: state.result!.payouts,
        winnerId: state.result!.winnerId as string | null,
        hands: Object.fromEntries(Object.entries(state.result!.hands).map(([id, h]) => [id, h.label])) as Record<string, unknown>,
        rematches: state.rematchNo,
      };
    case "poker7":
      return {
        payouts: state.result!.payouts,
        winnerId: state.result!.winnerId as string | null,
        hands: Object.fromEntries(Object.entries(state.result!.hands).map(([id, h]) => [id, h.category])) as Record<string, unknown>,
        rematches: 0,
      };
    case "holdem":
      // payouts = 받은 금액(콜 안 된 초과분·돌려받은 몫 포함), hands = 쇼다운한 사람의 족보 이름
      return {
        payouts: state.result!.payouts,
        winnerId: state.result!.winnerId as string | null,
        hands: Object.fromEntries(Object.entries(state.result!.hands).map(([id, h]) => [id, h.category])) as Record<string, unknown>,
        rematches: 0,
      };
    case "blackjack":
      // payouts = 좌석별 손익 (하우스와 정산), 손마다 카드·점수·결과
      return {
        payouts: state.result!.deltas,
        winnerId: null as string | null,
        hands: Object.fromEntries(
          state.seats
            .filter((s) => s.status === "in")
            .map((s) => [s.id, s.hands.map((h) => ({ cards: h.cards, total: handTotal(h.cards).total, bet: h.bet, outcome: h.outcome }))]),
        ) as Record<string, unknown>,
        rematches: 0,
        dealer: { cards: state.dealer.cards, total: state.result!.dealerTotal },
      };
  }
}
