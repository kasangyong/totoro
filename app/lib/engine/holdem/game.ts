// 노리밋 텍사스 홀덤 진행 — holdem-arch.md 결정 1·3.
// reduce는 순수 함수다. 덱은 판 생성 때 섞어 secrets에 두고, 공용 카드는 번 1장씩 빼고 깐다.
import { awardPots, computePots, type Seat } from "../betting";
import { DECK_SIZE, type PokerCard } from "../poker7/hands";
import { createRng, shuffle, type SeedEntry } from "../rng";
import { maskCards, type HeldCard, type VisibleCard } from "../view";
import { bestHoldem, compareHoldem, type HoldemCategory } from "./hands";

export type HoldemPhase = "preflop" | "flop" | "turn" | "river" | "done";
export type HoldemMove = "fold" | "check" | "call" | "raise" | "allin";

export type HoldemSeat = {
  id: string;
  seatNo: number;
  stack: number;
  /** 이번 판에 낸 금액 (팟 계산) */
  handContrib: number;
  /** 이번 라운드에 낸 금액 */
  streetContrib: number;
  folded: boolean;
  allIn: boolean;
  /** 마지막 완전한 레이즈 이후 행동했는가 (짧은 올인은 다시 열지 않는다) */
  acted: boolean;
};

export type HoldemResult = {
  payouts: Record<string, number>;
  /** 메인 팟 승자 (여럿이면 좌석 번호가 가장 낮은 사람) */
  winnerId: string;
  /** 쇼다운한 사람만 (혼자 남아 이기면 비어 있다) */
  hands: Record<string, { category: HoldemCategory; cards: PokerCard[] }>;
};

export type HoldemState = {
  game: "holdem";
  handId: string;
  baseBet: number;
  buttonId: string;
  sbId: string;
  bbId: string;
  phase: HoldemPhase;
  seats: HoldemSeat[];
  /** 이번 라운드 최고액 (맞춰야 할 금액) */
  currentBet: number;
  /** 최소 레이즈 증가분 (직전 완전한 레이즈 크기, 처음엔 BB) */
  minRaise: number;
  toActId: string | null;
  board: PokerCard[];
  holes: HeldCard<PokerCard>[];
  result: HoldemResult | null;
  secrets: { deck: PokerCard[]; deckPos: number };
};

export type HoldemAction =
  | { type: "act"; seatId: string; action: HoldemMove; amount?: number }
  /** 기한이 지나면 체크, 못 하면 폴드 */
  | { type: "timeout"; seatId: string };

export type CreateHoldemHand = {
  handId: string;
  baseBet: number;
  /** 이번 판 버튼 */
  bossId: string;
  seats: { id: string; seatNo: number; stack: number }[];
  serverSeed: string;
  seeds: SeedEntry[];
};

export class HoldemError extends Error {}

const INITIAL_DECK: PokerCard[] = Array.from({ length: DECK_SIZE }, (_, i) => i);

export function holdemDeck(p: Pick<CreateHoldemHand, "serverSeed" | "handId" | "seeds">): PokerCard[] {
  return shuffle(INITIAL_DECK, createRng({ serverSeed: p.serverSeed, handId: p.handId, rematchNo: 0, seeds: p.seeds }));
}

export const smallBlind = (baseBet: number) => Math.max(1, Math.floor(baseBet / 2));

const canAct = (s: HoldemSeat) => !s.folded && !s.allIn;
const seatOf = (state: HoldemState, id: string) => state.seats.find((s) => s.id === id)!;
const liveSeats = (state: HoldemState) => state.seats.filter((s) => !s.folded);

/** 좌석 순서로 id 다음(시계 방향)부터 한 바퀴. inclusive면 id 자신부터. */
function clockwise(state: HoldemState, fromId: string, inclusive: boolean): HoldemSeat[] {
  const i = state.seats.findIndex((s) => s.id === fromId);
  const n = state.seats.length;
  return Array.from({ length: n }, (_, k) => state.seats[(i + (inclusive ? k : k + 1)) % n]);
}

function pay(seat: HoldemSeat, amount: number): HoldemSeat {
  const paid = Math.min(amount, seat.stack);
  return {
    ...seat,
    stack: seat.stack - paid,
    handContrib: seat.handContrib + paid,
    streetContrib: seat.streetContrib + paid,
    allIn: seat.stack - paid === 0,
  };
}

const updateSeat = (state: HoldemState, id: string, f: (s: HoldemSeat) => HoldemSeat): HoldemState => ({
  ...state,
  seats: state.seats.map((s) => (s.id === id ? f(s) : s)),
});

function needsAction(state: HoldemState, s: HoldemSeat): boolean {
  return canAct(s) && (!s.acted || s.streetContrib < state.currentBet);
}

function roundOver(state: HoldemState): boolean {
  if (liveSeats(state).length <= 1) return true;
  const actors = state.seats.filter(canAct);
  if (actors.length === 0) return true;
  // 행동할 수 있는 사람이 1명뿐이고 이미 최고액 이상을 냈으면 더 물을 것이 없다
  if (actors.length === 1 && actors[0].streetContrib >= state.currentBet) return true;
  return !state.seats.some((s) => needsAction(state, s));
}

function nextNeeding(state: HoldemState, fromId: string, inclusive: boolean): string | null {
  return clockwise(state, fromId, inclusive).find((s) => needsAction(state, s))?.id ?? null;
}

function draw(state: HoldemState, n: number): [PokerCard[], HoldemState] {
  const { deck, deckPos } = state.secrets;
  return [deck.slice(deckPos, deckPos + n), { ...state, secrets: { ...state.secrets, deckPos: deckPos + n } }];
}

export function createHoldemHand(p: CreateHoldemHand, deck: PokerCard[] = holdemDeck(p)): HoldemState {
  if (p.seats.length < 2 || p.seats.length > 9) throw new HoldemError("홀덤은 2~9명");
  if (!Number.isSafeInteger(p.baseBet) || p.baseBet < 2) throw new HoldemError("baseBet must be an integer ≥ 2");
  if (p.seats.some((s) => !Number.isSafeInteger(s.stack) || s.stack < 1)) throw new HoldemError("bad stack");
  if (new Set(p.seats.map((s) => s.id)).size !== p.seats.length || new Set(p.seats.map((s) => s.seatNo)).size !== p.seats.length) {
    throw new HoldemError("duplicate seat");
  }
  if (!p.seats.some((s) => s.id === p.bossId)) throw new HoldemError("button not seated");
  if (deck.length !== DECK_SIZE || new Set(deck).size !== DECK_SIZE || deck.some((c) => !Number.isInteger(c) || c < 0 || c >= DECK_SIZE)) {
    throw new HoldemError("deck must use each card 0..51 once");
  }
  let state: HoldemState = {
    game: "holdem",
    handId: p.handId,
    baseBet: p.baseBet,
    buttonId: p.bossId,
    sbId: "",
    bbId: "",
    phase: "preflop",
    seats: [...p.seats]
      .sort((a, b) => a.seatNo - b.seatNo)
      .map((s) => ({ id: s.id, seatNo: s.seatNo, stack: s.stack, handContrib: 0, streetContrib: 0, folded: false, allIn: false, acted: false })),
    currentBet: 0,
    minRaise: p.baseBet,
    toActId: null,
    board: [],
    holes: [],
    result: null,
    secrets: { deck, deckPos: 0 },
  };
  // 헤즈업은 버튼이 SB, 아니면 버튼 왼쪽이 SB · 그 왼쪽이 BB
  const headsUp = state.seats.length === 2;
  const sbId = headsUp ? p.bossId : clockwise(state, p.bossId, false)[0].id;
  const bbId = clockwise(state, sbId, false)[0].id;
  // 개인 카드: 버튼 왼쪽부터 한 장씩 두 바퀴 (헤즈업이면 BB부터, 버튼이 마지막)
  const order = clockwise(state, p.bossId, false).map((s) => s.id);
  for (let round = 0; round < 2; round++) {
    for (const ownerId of order) {
      const [[card], next] = draw(state, 1);
      state = { ...next, holes: [...next.holes, { ownerId, faceUp: false, card }] };
    }
  }
  state = updateSeat(state, sbId, (s) => pay(s, smallBlind(p.baseBet)));
  state = updateSeat(state, bbId, (s) => pay(s, p.baseBet));
  // 블라인드는 행동으로 치지 않는다. BB가 짧게 올인했어도 콜 금액은 BB 전액.
  state = { ...state, sbId, bbId, currentBet: p.baseBet, minRaise: p.baseBet };
  const first = headsUp ? sbId : clockwise(state, bbId, false)[0].id;
  return startBetting(state, first);
}

/** 라운드 시작: 행동할 사람이 없으면 다음 라운드(런아웃) */
function startBetting(state: HoldemState, firstId: string): HoldemState {
  if (roundOver(state)) return nextStreet({ ...state, toActId: null });
  return { ...state, toActId: nextNeeding(state, firstId, true) };
}

function nextStreet(state: HoldemState): HoldemState {
  if (liveSeats(state).length <= 1 || state.phase === "river") return finish(state);
  const phase: HoldemPhase = state.phase === "preflop" ? "flop" : state.phase === "flop" ? "turn" : "river";
  const [, burned] = draw(state, 1);
  const [cards, next] = draw(burned, phase === "flop" ? 3 : 1);
  const reset: HoldemState = {
    ...next,
    phase,
    board: [...next.board, ...cards],
    seats: next.seats.map((s) => ({ ...s, streetContrib: 0, acted: false })),
    currentBet: 0,
    minRaise: next.baseBet,
    toActId: null,
  };
  // 플랍부터는 버튼 왼쪽의 살아 있는 사람부터 (헤즈업이면 BB부터)
  return startBetting(reset, clockwise(reset, reset.buttonId, false)[0].id);
}

function maxRaiseTo(s: HoldemSeat) {
  return s.streetContrib + s.stack;
}

/** 지금 이 사람이 할 수 있는 수 */
export function legalHoldem(state: HoldemState, seatId: string): HoldemMove[] {
  if (state.phase === "done" || state.toActId !== seatId) return [];
  const s = seatOf(state, seatId);
  if (!canAct(s)) return [];
  const toCall = state.currentBet - s.streetContrib;
  const respond = state.seats.some((x) => x.id !== seatId && canAct(x));
  const moves: HoldemMove[] = ["fold", toCall > 0 ? "call" : "check"];
  if (!s.acted && respond && maxRaiseTo(s) >= state.currentBet + state.minRaise) moves.push("raise");
  if (!s.acted && respond && s.stack > toCall) moves.push("allin");
  return moves;
}

/** 레이즈(총액) 범위. 레이즈를 못 하면 null */
export function raiseBounds(state: HoldemState, seatId: string): { min: number; max: number } | null {
  if (!legalHoldem(state, seatId).includes("raise")) return null;
  const s = seatOf(state, seatId);
  return { min: state.currentBet + state.minRaise, max: maxRaiseTo(s) };
}

function act(state: HoldemState, seatId: string, move: HoldemMove, amount?: number): HoldemState {
  const legal = legalHoldem(state, seatId);
  if (!legal.includes(move)) throw new HoldemError(`illegal move ${move}`);
  const seat = seatOf(state, seatId);
  let s = state;
  let to: number | null = null; // 올린 총액 (raise/allin)
  switch (move) {
    case "fold":
      s = updateSeat(s, seatId, (x) => ({ ...x, folded: true }));
      break;
    case "check":
      break;
    case "call":
      s = updateSeat(s, seatId, (x) => pay(x, state.currentBet - x.streetContrib));
      break;
    case "raise": {
      const b = raiseBounds(state, seatId)!;
      if (amount === undefined || !Number.isSafeInteger(amount) || amount < b.min || amount > b.max) throw new HoldemError("bad raise amount");
      to = amount;
      break;
    }
    case "allin":
      to = maxRaiseTo(seat);
      break;
  }
  if (to !== null) {
    s = updateSeat(s, seatId, (x) => pay(x, to! - x.streetContrib));
    if (to > s.currentBet) {
      const increment = to - s.currentBet;
      const full = increment >= s.minRaise;
      // 완전한 레이즈만 다른 사람의 레이즈 기회를 다시 연다
      s = {
        ...s,
        currentBet: to,
        minRaise: full ? increment : s.minRaise,
        seats: full ? s.seats.map((x) => (x.id !== seatId && canAct(x) ? { ...x, acted: false } : x)) : s.seats,
      };
    }
  }
  s = updateSeat(s, seatId, (x) => ({ ...x, acted: true }));
  if (liveSeats(s).length <= 1) return finish({ ...s, toActId: null });
  if (roundOver(s)) return nextStreet({ ...s, toActId: null });
  return { ...s, toActId: nextNeeding(s, seatId, false) };
}

function asPotSeats(seats: readonly HoldemSeat[]): Seat[] {
  return seats.map((x) => ({ ...x, roundContrib: x.streetContrib }));
}

function finish(state: HoldemState): HoldemState {
  const live = liveSeats(state);
  // 살아 있는 사람 누구도 맞출 수 없는 초과분(폴드한 사람이 더 낸 몫 포함)은 낸 사람에게 돌려준다
  const cap = Math.max(...live.map((x) => x.handContrib));
  const refunds = state.seats.filter((x) => x.handContrib > cap).map((x) => [x.id, x.handContrib - cap] as const);
  const potSeats = asPotSeats(state.seats.map((x) => ({ ...x, handContrib: Math.min(x.handContrib, cap) })));
  let totals: Map<string, number>;
  let hands: HoldemResult["hands"] = {};
  let winnerId: string;
  let holes = state.holes;
  let board = state.board;
  let s = state;
  if (live.length === 1) {
    // 혼자 남으면 패를 보여 주지 않고 팟 전부
    winnerId = live[0].id;
    totals = new Map([[winnerId, potSeats.reduce((a, x) => a + x.handContrib, 0)]]);
  } else {
    // 방어용: 보통은 nextStreet가 리버까지 깔고 오므로 이 루프는 돌지 않는다 (번 순서는 nextStreet와 같다)
    while (board.length < 5) {
      const [, burned] = draw(s, 1);
      const [cards, next] = draw(burned, board.length === 0 ? 3 : 1);
      s = next;
      board = [...board, ...cards];
    }
    const best = Object.fromEntries(
      live.map((x) => [x.id, bestHoldem([...state.holes.filter((h) => h.ownerId === x.id).map((h) => h.card), ...board])]),
    );
    hands = Object.fromEntries(Object.entries(best).map(([id, h]) => [id, { category: h.category, cards: h.cards }]));
    holes = state.holes.map((h) => (best[h.ownerId] ? { ...h, faceUp: true } : h));
    const winnersOf = (eligible: readonly string[]) => {
      const contenders = eligible.filter((id) => best[id]);
      let top: string[] = [];
      for (const id of contenders) {
        const c = top.length === 0 ? 1 : compareHoldem(best[id].score, best[top[0]].score);
        if (c > 0) top = [id];
        else if (c === 0) top.push(id);
      }
      return top;
    };
    const pots = computePots(potSeats);
    totals = awardPots(pots, potSeats, winnersOf);
    const mainWinners = winnersOf(pots[0].eligible);
    winnerId = state.seats.filter((x) => mainWinners.includes(x.id)).sort((a, b) => a.seatNo - b.seatNo)[0].id;
  }
  for (const [id, amt] of refunds) totals.set(id, (totals.get(id) ?? 0) + amt);
  return {
    ...s,
    phase: "done",
    board,
    holes,
    toActId: null,
    seats: s.seats.map((x) => ({ ...x, stack: x.stack + (totals.get(x.id) ?? 0), handContrib: 0, streetContrib: 0 })),
    result: { payouts: Object.fromEntries(totals), winnerId, hands },
  };
}

export function reduceHoldem(state: HoldemState, action: HoldemAction): HoldemState {
  if (state.phase === "done") throw new HoldemError("hand is over");
  if (state.toActId !== action.seatId) throw new HoldemError("not your turn");
  if (action.type === "timeout") {
    return act(state, action.seatId, legalHoldem(state, action.seatId).includes("check") ? "check" : "fold");
  }
  return act(state, action.seatId, action.action, action.amount);
}

export type HoldemView = Omit<HoldemState, "secrets" | "holes"> & { holes: VisibleCard<PokerCard>[] };

export function viewHoldem(state: HoldemState, viewerId: string | null): HoldemView {
  const { secrets: _secrets, holes, ...rest } = state;
  void _secrets;
  return { ...rest, holes: maskCards(holes, viewerId) };
}
