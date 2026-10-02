// 섯다(2장·3장) 진행 — card-games-rules.md "섯다" + rooms-arch.md 결정 3·4 + sutda3-arch.md.
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
import { DECK_SIZE, evaluate, isSpecial, monthOf, resolve, type SutdaCard, type SutdaHand } from "./hands";

export const MAX_REMATCHES = 3;

/** 3장 섯다: open(공개할 1장 고름) → bet1 → pick(쓸 2장 고름) → bet2 */
export type SutdaPhase = "open" | "bet1" | "pick" | "bet2" | "rejoin" | "done";

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
  /** 없으면 2장 섯다 (예전 상태 호환) */
  variant?: 2 | 3;
  /** 3장 섯다 선택 단계에서 이미 정한 사람 (무엇을 골랐는지는 secrets에만) */
  chosen?: string[];
  /** 3장 섯다 쇼다운에서 각자 쓴 2장 */
  used?: Record<string, [SutdaCard, SutdaCard]>;
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
  /** 구사 재경기 참여 결정 대기 중일 때만 */
  rejoin: SutdaRejoin | null;
  result: SutdaResult | null;
  secrets: {
    decks: SutdaCard[][];
    deckPos: number;
    /** 구사 재경기 참여 결정 (전원이 정할 때까지 비공개) */
    rejoinChoices?: Record<string, boolean>;
    /** 3장 섯다: 공개할 카드 (전원이 정할 때까지) */
    opens?: Record<string, SutdaCard>;
    /** 3장 섯다: 쓸 2장 (쇼다운 전까지) */
    picks?: Record<string, [SutdaCard, SutdaCard]>;
  };
};

export type SutdaShowdown = {
  rematchNo: number;
  cards: HeldCard<SutdaCard>[];
  hands: Record<string, SutdaHand>;
  reasons: ("구사" | "동점")[];
  /** 3장 섯다: 그 경기에서 각자 쓴 2장 */
  used?: Record<string, [SutdaCard, SutdaCard]>;
};

export type SutdaAction =
  | { type: "bet"; seatId: string; action: BetActionType }
  | { type: "timeout"; seatId: string }
  | { type: "rejoin"; seatId: string; join: boolean }
  /** 참여 결정 기한이 지나면 아직 안 정한 사람은 모두 불참 */
  | { type: "rejoin_timeout" }
  // 3장 섯다
  | { type: "open"; seatId: string; card: SutdaCard }
  | { type: "pick"; seatId: string; cards: [SutdaCard, SutdaCard] }
  /** 선택 기한이 지나면 아직 안 정한 사람은 자동 선택 */
  | { type: "choice_timeout" };

export type SutdaRejoin = {
  /** 참여금 = 구사 팟 합계의 절반 (내림) */
  fee: number;
  candidates: string[];
  /** 이미 정한 사람 (참여/불참 여부는 비공개) */
  decided: string[];
  /** carried 중 구사 재경기 팟의 위치 */
  gusaPots: number[];
};

export type CreateSutdaHand = {
  handId: string;
  variant?: 2 | 3;
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
  if (p.variant !== undefined && p.variant !== 2 && p.variant !== 3) throw new SutdaError("variant must be 2 or 3");
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
    round: { high: 0, raises: {}, bossId: p.bossId, toActId: null },
    cards: [],
    carried: [],
    paid: {},
    mainWinnerId: null,
    history: [],
    rejoin: null,
    result: null,
    secrets: { decks, deckPos: 0 },
  };
  // 3장 섯다: 보스부터 한 장씩 두 바퀴 → 공개할 카드 고르기
  if (p.variant === 3) return startOpen(dealOne(dealOne({ ...base, variant: 3 })));
  return beginRound(dealOne(base));
}

const isThree = (state: SutdaState) => state.variant === 3;

function startOpen(state: SutdaState): SutdaState {
  return {
    ...state,
    phase: "open",
    chosen: [],
    used: undefined,
    round: { ...state.round, toActId: null },
    secrets: { ...state.secrets, opens: {}, picks: undefined },
  };
}

const cardsOf = (state: SutdaState, id: string) => state.cards.filter((c) => c.ownerId === id).map((c) => c.card);

/** [우리 규칙] 공개 시간 초과: 월이 낮은 카드, 같은 월이면 일반패 */
function autoOpen(cards: readonly SutdaCard[]): SutdaCard {
  return [...cards].sort((x, y) => monthOf(x) - monthOf(y) || Number(isSpecial(x)) - Number(isSpecial(y)))[0];
}

/** [우리 규칙] 조합 시간 초과: 평소 값이 가장 높은 조합, 같으면 (오름차순 정렬한) 조합의 사전순으로 앞선 것 */
export function autoPick(cards: readonly SutdaCard[]): [SutdaCard, SutdaCard] {
  const s = [...cards].sort((x, y) => x - y);
  const combos: [SutdaCard, SutdaCard][] = [
    [s[0], s[1]],
    [s[0], s[2]],
    [s[1], s[2]],
  ];
  let best = combos[0];
  for (const c of combos) if (evaluate(c[0], c[1]).value > evaluate(best[0], best[1]).value) best = c;
  return best;
}

function decideOpen(state: SutdaState, seatId: string, card: SutdaCard): SutdaState {
  const chosen = state.chosen ?? [];
  if (!liveIds(state).includes(seatId)) throw new SutdaError("not in this choice");
  if (chosen.includes(seatId)) throw new SutdaError("already chose");
  if (!cardsOf(state, seatId).includes(card)) throw new SutdaError("not your card");
  const next: SutdaState = {
    ...state,
    chosen: [...chosen, seatId],
    secrets: { ...state.secrets, opens: { ...state.secrets.opens, [seatId]: card } },
  };
  if (next.chosen!.length < liveIds(next).length) return next;
  // 전원이 정하면 동시에 공개하고 1차 베팅
  const opens = next.secrets.opens!;
  const cards = next.cards.map((c) => (opens[c.ownerId] === c.card ? { ...c, faceUp: true } : c));
  return beginRound({ ...next, cards, phase: "bet1", chosen: [], secrets: { ...next.secrets, opens: undefined } });
}

function decidePick(state: SutdaState, seatId: string, pair: readonly [SutdaCard, SutdaCard]): SutdaState {
  const chosen = state.chosen ?? [];
  if (!liveIds(state).includes(seatId)) throw new SutdaError("not in this choice");
  if (chosen.includes(seatId)) throw new SutdaError("already chose");
  const [a, b] = pair;
  const mine = cardsOf(state, seatId);
  if (a === b || !mine.includes(a) || !mine.includes(b)) throw new SutdaError("bad pick");
  const next: SutdaState = {
    ...state,
    chosen: [...chosen, seatId],
    secrets: { ...state.secrets, picks: { ...state.secrets.picks, [seatId]: [Math.min(a, b), Math.max(a, b)] } },
  };
  if (next.chosen!.length < liveIds(next).length) return next;
  return beginRound({ ...next, phase: "bet2", chosen: [] });
}

function chooseTimeout(state: SutdaState): SutdaState {
  const pending = liveIds(state).filter((id) => !(state.chosen ?? []).includes(id));
  const open = state.phase === "open";
  return pending.reduce(
    (s, id) => (open ? decideOpen(s, id, autoOpen(cardsOf(s, id))) : decidePick(s, id, autoPick(cardsOf(s, id)))),
    state,
  );
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
  if (isThree(state)) {
    // 3번째 카드 → 쓸 2장 고르기 (고른 뒤 2차 베팅)
    const dealt = dealOne(state);
    return { ...dealt, phase: "pick", chosen: [], round: { ...dealt.round, toActId: null }, secrets: { ...dealt.secrets, picks: {} } };
  }
  return beginRound(dealOne({ ...state, phase: "bet2" }));
}

function handsOf(state: SutdaState, ids: readonly string[]): Record<string, SutdaHand> {
  const out: Record<string, SutdaHand> = {};
  for (const id of ids) {
    const mine = isThree(state) ? state.secrets.picks![id] : state.cards.filter((c) => c.ownerId === id).map((c) => c.card);
    out[id] = evaluate(mine[0], mine[1]);
  }
  return out;
}

function showdown(state: SutdaState): SutdaState {
  const live = liveIds(state);
  const picks = state.secrets.picks ?? {};
  // 혼자 남아 이기면 패를 공개하지 않는다. 3장 섯다는 고른 2장만 공개 (숨긴 채 버린 카드는 뒷면 그대로).
  const reveal = (c: HeldCard<SutdaCard>) => live.includes(c.ownerId) && (!isThree(state) || picks[c.ownerId].includes(c.card));
  const cards = live.length > 1 ? state.cards.map((c) => (reveal(c) ? { ...c, faceUp: true } : c)) : state.cards;
  const used = isThree(state) && live.length > 1 ? Object.fromEntries(live.map((id) => [id, picks[id]])) : undefined;
  const pots: Pot[] = [...state.carried, ...(state.seats.some((s) => s.handContrib > 0) ? computePots(state.seats) : [])];

  const hands = live.length > 1 ? handsOf(state, live) : {};
  const settled: Settled[] = [];
  const pending: Pot[] = [];
  const rematchIds = new Set<string>();
  const reasons = new Set<"구사" | "동점">();
  let mainWinnerId = state.mainWinnerId;
  let splitByLimit = false;
  /** pending 중 구사 재경기로 넘어가는 팟의 위치 */
  const gusaPots: number[] = [];

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
      if (r.reason === "구사") gusaPots.push(pending.length);
      pending.push({ amount: pot.amount, eligible: r.participants });
      r.participants.forEach((id) => rematchIds.add(id));
      reasons.add(r.reason);
    }
  }

  if (pending.length === 0) {
    return finish({ ...state, cards, mainWinnerId, ...(used ? { used } : {}) }, settled, hands, splitByLimit);
  }

  // 재경기가 필요 없는 팟은 먼저 지급하고, 나머지는 새 패로 다시 겨룬다.
  const early = settledTotals(state.seats, settled);
  const record: SutdaShowdown = {
    rematchNo: state.rematchNo,
    cards: cards.filter((c) => c.faceUp),
    hands,
    reasons: [...reasons],
    ...(used ? { used } : {}),
  };
  const pendingState: SutdaState = {
    ...state,
    // 건 돈은 모두 pending 팟으로 옮겨졌으므로 기여는 0. folded는 참여 후보 판단에 쓰려고 그대로 둔다.
    seats: state.seats.map((s) => ({ ...s, stack: s.stack + (early.get(s.id) ?? 0), handContrib: 0, roundContrib: 0 })),
    participants: [...rematchIds],
    cards: [],
    carried: pending,
    paid: mergeTotals(state.paid, early),
    mainWinnerId,
    history: [...state.history, record],
    round: { ...state.round, toActId: null },
    // 3장 섯다: 지난 경기 선택은 재참여 결정 중 화면에 남지 않게 지운다 (history에 used로 남음)
    ...(isThree(state) ? { secrets: { ...state.secrets, picks: undefined } } : {}),
  };

  // 구사 재경기: 이번 경기에서 다이한 사람도 구사 팟 판돈의 절반을 내면 들어올 수 있다 (동점 팟은 해당 없음).
  if (gusaPots.length > 0) {
    const fee = Math.floor(gusaPots.reduce((a, i) => a + pending[i].amount, 0) / 2);
    const candidates = pendingState.seats
      .filter((s) => state.participants.includes(s.id) && s.folded && !rematchIds.has(s.id) && s.stack >= fee)
      .map((s) => s.id);
    if (fee > 0 && candidates.length > 0) {
      return {
        ...pendingState,
        phase: "rejoin",
        rejoin: { fee, candidates, decided: [], gusaPots },
        secrets: { ...pendingState.secrets, rejoinChoices: {} },
      };
    }
  }
  return startRematch(pendingState);
}

function startRematch(state: SutdaState): SutdaState {
  const seats = state.seats.map((s) => {
    const inRematch = state.participants.includes(s.id);
    return {
      ...s,
      handContrib: 0,
      roundContrib: 0,
      folded: !inRematch,
      // 규칙: 올인했던 사람은 재경기에 참가하되 추가 베팅 없음 (먼저 받은 팟이 있어도 동일).
      allIn: s.allIn || s.stack === 0,
      acted: false,
    };
  });
  const base: SutdaState = {
    ...state,
    phase: "bet1",
    rematchNo: state.rematchNo + 1,
    seats,
    rejoin: null,
    secrets: { ...state.secrets, deckPos: 0 },
  };
  // 3장 섯다 재경기도 공개 선택부터 (지난 경기 선택/used는 지우고 history에만 남는다)
  if (isThree(state)) return startOpen(dealOne(dealOne(base)));
  return beginRound(dealOne(base));
}

/** 결정 내용은 전원이 정할 때까지 secrets에만 두고, 공개 상태에는 "누가 정했는지"만 남긴다. */
function decideRejoin(state: SutdaState, seatId: string, join: boolean): SutdaState {
  const rejoin = state.rejoin!;
  if (!rejoin.candidates.includes(seatId) || rejoin.decided.includes(seatId)) throw new SutdaError("cannot decide rejoin");
  const choices = { ...state.secrets.rejoinChoices, [seatId]: join };
  const next: SutdaState = {
    ...state,
    rejoin: { ...rejoin, decided: [...rejoin.decided, seatId] },
    secrets: { ...state.secrets, rejoinChoices: choices },
  };
  return next.rejoin!.decided.length === rejoin.candidates.length ? applyRejoins(next) : next;
}

function applyRejoins(state: SutdaState): SutdaState {
  const { fee, gusaPots } = state.rejoin!;
  const choices = state.secrets.rejoinChoices ?? {};
  const joiners = orderBySeat(state.seats, state.rejoin!.candidates.filter((id) => choices[id]));
  const firstGusa = gusaPots[0];
  const next: SutdaState = {
    ...state,
    seats: state.seats.map((s) => (joiners.includes(s.id) ? { ...s, stack: s.stack - fee } : s)),
    // [우리 규칙] 참여금은 첫 구사 팟에 더하고, 들어온 사람은 구사 팟에만 자격을 얻는다.
    carried: state.carried.map((p, i) =>
      gusaPots.includes(i)
        ? { amount: p.amount + (i === firstGusa ? fee * joiners.length : 0), eligible: [...p.eligible, ...joiners] }
        : p,
    ),
    participants: [...state.participants, ...joiners],
    secrets: { ...state.secrets, rejoinChoices: undefined },
  };
  return startRematch(next);
}

function orderBySeat(seats: readonly Seat[], ids: readonly string[]): string[] {
  return seats.filter((s) => ids.includes(s.id)).sort((a, b) => a.seatNo - b.seatNo).map((s) => s.id);
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
  if (state.phase === "rejoin") {
    if (action.type === "rejoin") return decideRejoin(state, action.seatId, action.join);
    if (action.type === "rejoin_timeout") {
      const undecided = state.rejoin!.candidates.filter((id) => !state.rejoin!.decided.includes(id));
      return undecided.reduce((s, id) => decideRejoin(s, id, false), state);
    }
    throw new SutdaError("waiting for rejoin decisions");
  }
  if (state.phase === "open" || state.phase === "pick") {
    if (action.type === "open" && state.phase === "open") return decideOpen(state, action.seatId, action.card);
    if (action.type === "pick" && state.phase === "pick") return decidePick(state, action.seatId, action.cards);
    if (action.type === "choice_timeout") return chooseTimeout(state);
    throw new SutdaError("waiting for choices");
  }
  if (action.type === "rejoin" || action.type === "rejoin_timeout") throw new SutdaError("no rejoin in progress");
  if (action.type === "open" || action.type === "pick" || action.type === "choice_timeout") throw new SutdaError("no choice in progress");
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

export type SutdaView = Omit<SutdaState, "secrets" | "cards"> & {
  cards: VisibleCard<SutdaCard>[];
  /** 3장 섯다: 내가 확정한 공개 카드·쓸 2장 (본인 것만, 남의 선택은 어디에도 없다) */
  myOpen?: SutdaCard | null;
  myPick?: [SutdaCard, SutdaCard] | null;
};

export function viewSutda(state: SutdaState, viewerId: string | null): SutdaView {
  const { secrets, cards, ...rest } = state;
  const mine =
    isThree(state) && viewerId !== null
      ? { myOpen: secrets.opens?.[viewerId] ?? null, myPick: secrets.picks?.[viewerId] ?? null }
      : {};
  return { ...rest, cards: maskCards(cards, viewerId), ...mine };
}
