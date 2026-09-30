// 섯다(2장) 진행 — card-games-rules.md "섯다" + rooms-arch.md 결정 3·4.
// reduce는 순수 함수다. 덱은 판 생성 때 재경기분까지 미리 섞어 secrets에 둔다.
import {
  applyAction,
  awardPots,
  computePots,
  isRoundOver,
  legalActions,
  postAntes,
  startRound,
  type BetActionType,
  type Pot,
  type Round,
  type Seat,
} from "../betting";
import { createRng, shuffle, type SeedEntry } from "../rng";
import { maskCards, type HeldCard, type VisibleCard } from "../view";
import { DECK_SIZE, evaluate, resolve, type SutdaCard, type SutdaHand } from "./hands";

export const MAX_REMATCHES = 3;

export type SutdaPhase = "bet1" | "bet2" | "done";

export type SutdaResult = {
  payouts: Record<string, number>;
  /** 다음 판 보스 = 메인 팟 승자 */
  winnerId: string;
  hands: Record<string, SutdaHand>;
  splitAfterMaxRematches: boolean;
};

export type SutdaState = {
  game: "sutda";
  handId: string;
  baseBet: number;
  bossId: string;
  phase: SutdaPhase;
  rematchNo: number;
  seats: Seat[];
  /** 이번 (재)경기 참가자. 재경기에서 빠진 사람은 여기 없다. */
  participants: string[];
  round: Round;
  cards: HeldCard<SutdaCard>[];
  /** 재경기로 넘어온 팟. 새로 건 돈은 seats.handContrib로 따로 쌓인다. */
  carried: Pot[];
  /** 재경기 전에 먼저 지급한 금액 (판 전체 지급 합계에 포함) */
  paid: Record<string, number>;
  /** 메인 팟(전원이 자격 있는 첫 팟) 승자. 정산되면 채워진다. */
  mainWinnerId: string | null;
  /** 재경기로 이어진 쇼다운 기록 (공개된 패만) */
  history: SutdaShowdown[];
  result: SutdaResult | null;
  secrets: { decks: SutdaCard[][]; deckPos: number };
};

export type SutdaShowdown = {
  rematchNo: number;
  cards: HeldCard<SutdaCard>[];
  hands: Record<string, SutdaHand>;
  reasons: ("구사" | "동점")[];
};

export type SutdaAction =
  | { type: "bet"; seatId: string; action: BetActionType }
  | { type: "timeout"; seatId: string };

export type CreateSutdaHand = {
  handId: string;
  baseBet: number;
  bossId: string;
  seats: { id: string; seatNo: number; stack: number }[];
  serverSeed: string;
  seeds: SeedEntry[];
};

export class SutdaError extends Error {}

const INITIAL_DECK: SutdaCard[] = Array.from({ length: DECK_SIZE }, (_, i) => i);

export function sutdaDecks(p: Pick<CreateSutdaHand, "serverSeed" | "handId" | "seeds">): SutdaCard[][] {
  return Array.from({ length: MAX_REMATCHES + 1 }, (_, rematchNo) =>
    shuffle(INITIAL_DECK, createRng({ serverSeed: p.serverSeed, handId: p.handId, rematchNo, seeds: p.seeds })),
  );
}

export function createSutdaHand(p: CreateSutdaHand, decks: SutdaCard[][] = sutdaDecks(p)): SutdaState {
  if (p.seats.length < 2 || p.seats.length > 6) throw new SutdaError("섯다는 2~6명");
  if (!p.seats.some((s) => s.id === p.bossId)) throw new SutdaError("boss not seated");
  if (!Number.isSafeInteger(p.baseBet) || p.baseBet < 1) throw new SutdaError("baseBet must be a positive integer");
  // 규칙: 판 시작 시 스택은 기본금 이상 (모자라면 이전 판 종료 때 자동으로 일어섬).
  if (p.seats.some((s) => !Number.isSafeInteger(s.stack) || s.stack < p.baseBet)) throw new SutdaError("bad stack");
  const seats = postAntes(
    p.seats.map((s) => ({
      ...s,
      handContrib: 0,
      roundContrib: 0,
      folded: false,
      allIn: s.stack === 0,
      acted: false,
    })),
    p.baseBet,
  );
  const base: SutdaState = {
    game: "sutda",
    handId: p.handId,
    baseBet: p.baseBet,
    bossId: p.bossId,
    phase: "bet1",
    rematchNo: 0,
    seats,
    participants: seats.map((s) => s.id),
    round: { high: 0, raises: 0, bossId: p.bossId, toActId: null },
    cards: [],
    carried: [],
    paid: {},
    mainWinnerId: null,
    history: [],
    result: null,
    secrets: { decks, deckPos: 0 },
  };
  return beginRound(dealOne(base));
}

function orderFromBoss(state: SutdaState, ids: readonly string[]): string[] {
  const ordered = [...state.seats].filter((s) => ids.includes(s.id)).sort((a, b) => a.seatNo - b.seatNo);
  const boss = state.seats.find((s) => s.id === state.bossId)!;
  const start = Math.max(0, ordered.findIndex((s) => s.seatNo >= boss.seatNo));
  return [...ordered.slice(start), ...ordered.slice(0, start)].map((s) => s.id);
}

function liveIds(state: SutdaState): string[] {
  return state.seats.filter((s) => state.participants.includes(s.id) && !s.folded).map((s) => s.id);
}

function dealOne(state: SutdaState): SutdaState {
  const deck = state.secrets.decks[state.rematchNo];
  let pos = state.secrets.deckPos;
  const dealt: HeldCard<SutdaCard>[] = orderFromBoss(state, liveIds(state)).map((ownerId) => ({
    ownerId,
    faceUp: false,
    card: deck[pos++],
  }));
  return { ...state, cards: [...state.cards, ...dealt], secrets: { ...state.secrets, deckPos: pos } };
}

function beginRound(state: SutdaState): SutdaState {
  const inPlay = state.seats.map((s) => (state.participants.includes(s.id) ? s : { ...s, folded: true }));
  const { seats, round } = startRound(inPlay, state.bossId);
  const next: SutdaState = {
    ...state,
    seats: seats.map((s, i) => (state.participants.includes(s.id) ? s : state.seats[i])),
    round,
  };
  return isRoundOver(round) ? advance(next) : next;
}

function advance(state: SutdaState): SutdaState {
  if (liveIds(state).length <= 1 || state.phase === "bet2") return showdown(state);
  return beginRound(dealOne({ ...state, phase: "bet2" }));
}

function handsOf(state: SutdaState, ids: readonly string[]): Record<string, SutdaHand> {
  const out: Record<string, SutdaHand> = {};
  for (const id of ids) {
    const mine = state.cards.filter((c) => c.ownerId === id).map((c) => c.card);
    out[id] = evaluate(mine[0], mine[1]);
  }
  return out;
}

function showdown(state: SutdaState): SutdaState {
  const live = liveIds(state);
  // 혼자 남아 이기면 패를 공개하지 않는다.
  const cards = live.length > 1 ? state.cards.map((c) => (live.includes(c.ownerId) ? { ...c, faceUp: true } : c)) : state.cards;
  const pots: Pot[] = [...state.carried, ...(state.seats.some((s) => s.handContrib > 0) ? computePots(state.seats) : [])];

  const hands = live.length > 1 ? handsOf(state, live) : {};
  const settled: Settled[] = [];
  const pending: Pot[] = [];
  const rematchIds = new Set<string>();
  const reasons = new Set<"구사" | "동점">();
  let mainWinnerId = state.mainWinnerId;
  let splitByLimit = false;

  // 아직 메인 팟이 정산되지 않았다면 pots[0]이 메인 팟이다 (재경기로 넘길 때도 맨 앞에 둔다).
  const settle = (index: number, pot: Pot, winners: string[]) => {
    settled.push({ pot, winners });
    if (index === 0 && mainWinnerId === null) mainWinnerId = lowestSeat(state.seats, winners);
  };

  for (const [i, pot] of pots.entries()) {
    const eligibleLive = pot.eligible.filter((id) => live.includes(id));
    if (eligibleLive.length <= 1) {
      // [우리 규칙] 그 팟 자격자가 모두 다이했으면 원래 자격자끼리 나눈다.
      settle(i, pot, eligibleLive.length === 1 ? eligibleLive : pot.eligible);
      continue;
    }
    const r = resolve(eligibleLive.map((id) => ({ id, hand: hands[id] })));
    if (r.type === "win") {
      settle(i, pot, r.winners);
    } else if (state.rematchNo >= MAX_REMATCHES) {
      settle(i, pot, r.participants);
      splitByLimit = true;
    } else {
      pending.push({ amount: pot.amount, eligible: r.participants });
      r.participants.forEach((id) => rematchIds.add(id));
      reasons.add(r.reason);
    }
  }

  if (pending.length === 0) {
    return finish({ ...state, cards, mainWinnerId }, settled, hands, splitByLimit);
  }

  // 재경기가 필요 없는 팟은 먼저 지급하고, 나머지는 새 패로 다시 겨룬다.
  const early = settledTotals(state.seats, settled);
  const participants = [...rematchIds];
  const seats = state.seats.map((s) => {
    const stack = s.stack + (early.get(s.id) ?? 0);
    const inRematch = participants.includes(s.id);
    return {
      ...s,
      stack,
      handContrib: 0,
      roundContrib: 0,
      folded: !inRematch,
      // 규칙: 올인했던 사람은 재경기에 참가하되 추가 베팅 없음 (먼저 받은 팟이 있어도 동일).
      allIn: s.allIn || stack === 0,
      acted: false,
    };
  });
  const record: SutdaShowdown = {
    rematchNo: state.rematchNo,
    cards: cards.filter((c) => c.faceUp),
    hands,
    reasons: [...reasons],
  };
  return beginRound(
    dealOne({
      ...state,
      phase: "bet1",
      rematchNo: state.rematchNo + 1,
      seats,
      participants,
      cards: [],
      carried: pending,
      paid: mergeTotals(state.paid, early),
      mainWinnerId,
      history: [...state.history, record],
      secrets: { ...state.secrets, deckPos: 0 },
    }),
  );
}

type Settled = { pot: Pot; winners: string[] };

function lowestSeat(seats: readonly Seat[], ids: readonly string[]): string {
  return [...ids].sort(
    (a, b) => seats.find((s) => s.id === a)!.seatNo - seats.find((s) => s.id === b)!.seatNo,
  )[0];
}

function settledTotals(seats: readonly Seat[], settled: readonly Settled[]): Map<string, number> {
  return awardPots(
    settled.map((s) => s.pot),
    seats,
    (_eligible, i) => settled[i].winners,
  );
}

function mergeTotals(base: Record<string, number>, add: Map<string, number>): Record<string, number> {
  const out = { ...base };
  for (const [id, amt] of add) out[id] = (out[id] ?? 0) + amt;
  return out;
}

function finish(
  state: SutdaState,
  settled: readonly Settled[],
  hands: Record<string, SutdaHand>,
  split: boolean,
): SutdaState {
  const totals = settledTotals(state.seats, settled);
  const seats = state.seats.map((s) => ({ ...s, stack: s.stack + (totals.get(s.id) ?? 0), handContrib: 0, roundContrib: 0 }));
  if (state.mainWinnerId === null) throw new SutdaError("main pot was not settled");
  const winnerId = state.mainWinnerId;
  return {
    ...state,
    phase: "done",
    seats,
    carried: [],
    round: { ...state.round, toActId: null },
    result: { payouts: mergeTotals(state.paid, totals), winnerId, hands, splitAfterMaxRematches: split },
  };
}

export function reduceSutda(state: SutdaState, action: SutdaAction): SutdaState {
  if (state.phase === "done") throw new SutdaError("hand is over");
  if (state.round.toActId !== action.seatId) throw new SutdaError("not your turn");
  const bet: BetActionType =
    action.type === "bet"
      ? action.action
      : legalActions(state.seats, state.round, action.seatId).includes("check")
        ? "check"
        : "die";
  const { seats, round } = applyAction(state.seats, state.round, action.seatId, bet, state.baseBet);
  const next = { ...state, seats, round };
  return isRoundOver(round) ? advance(next) : next;
}

export type SutdaView = Omit<SutdaState, "secrets" | "cards"> & { cards: VisibleCard<SutdaCard>[] };

export function viewSutda(state: SutdaState, viewerId: string | null): SutdaView {
  const { secrets: _secrets, cards, ...rest } = state;
  void _secrets;
  return { ...rest, cards: maskCards(cards, viewerId) };
}
