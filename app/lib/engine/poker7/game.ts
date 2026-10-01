// 7포커 초이스 룰 진행 — card-games-rules.md "포커" + rooms-arch.md 결정 3·4.
// reduce는 순수 함수. 덱은 판 생성 때 섞어 secrets에 둔다.
import {
  applyAction,
  awardPots,
  computePots,
  isRoundOver,
  legalActions,
  postAntes,
  startRound,
  type BetActionType,
  type Round,
  type Seat,
} from "../betting";
import { createRng, shuffle, type SeedEntry } from "../rng";
import { maskCards, type HeldCard, type VisibleCard } from "../view";
import {
  DECK_SIZE,
  bestHand,
  compareScores,
  openCardsHand,
  rankOf,
  suitStrength,
  type Category,
  type PokerCard,
  type PokerHand,
} from "./hands";

export type Poker7Phase = "choice" | "bet" | "done";

export type Poker7Result = {
  payouts: Record<string, number>;
  winnerId: string;
  hands: Record<string, { category: Category; cards: PokerCard[] }>;
};

export type Poker7State = {
  game: "poker7";
  handId: string;
  baseBet: number;
  phase: Poker7Phase;
  /** 지금 베팅 중인 구 (4~7). 초이스 단계에서는 3 */
  street: number;
  seats: Seat[];
  round: Round;
  cards: HeldCard<PokerCard>[];
  /** 초이스를 마친 사람 (무엇을 골랐는지는 전원이 고를 때까지 비공개) */
  chosen: string[];
  result: Poker7Result | null;
  secrets: {
    deck: PokerCard[];
    deckPos: number;
    choices: Record<string, { discard: PokerCard; open: PokerCard }>;
  };
};

export type Poker7Action =
  | { type: "choose"; seatId: string; discard: PokerCard; open: PokerCard }
  /** 초이스 기한이 지나면 아직 안 고른 사람은 자동 선택 */
  | { type: "choice_timeout" }
  | { type: "bet"; seatId: string; action: BetActionType }
  | { type: "timeout"; seatId: string };

export type CreatePoker7Hand = {
  handId: string;
  baseBet: number;
  seats: { id: string; seatNo: number; stack: number }[];
  serverSeed: string;
  seeds: SeedEntry[];
};

export class Poker7Error extends Error {}

const INITIAL_DECK: PokerCard[] = Array.from({ length: DECK_SIZE }, (_, i) => i);

export function poker7Deck(p: Pick<CreatePoker7Hand, "serverSeed" | "handId" | "seeds">): PokerCard[] {
  return shuffle(INITIAL_DECK, createRng({ serverSeed: p.serverSeed, handId: p.handId, rematchNo: 0, seeds: p.seeds }));
}

export function createPoker7Hand(p: CreatePoker7Hand, deck: PokerCard[] = poker7Deck(p)): Poker7State {
  if (p.seats.length < 2 || p.seats.length > 6) throw new Poker7Error("7포커는 2~6명");
  if (!Number.isSafeInteger(p.baseBet) || p.baseBet < 1) throw new Poker7Error("baseBet must be a positive integer");
  if (p.seats.some((s) => !Number.isSafeInteger(s.stack) || s.stack < p.baseBet)) throw new Poker7Error("bad stack");
  if (new Set(p.seats.map((s) => s.id)).size !== p.seats.length || new Set(p.seats.map((s) => s.seatNo)).size !== p.seats.length) {
    throw new Poker7Error("duplicate seat");
  }
  if (deck.length !== DECK_SIZE || new Set(deck).size !== DECK_SIZE || deck.some((c) => !Number.isInteger(c) || c < 0 || c >= DECK_SIZE)) {
    throw new Poker7Error("deck must use each card 0..51 once");
  }
  const seats = postAntes(
    p.seats.map((s) => ({ ...s, handContrib: 0, roundContrib: 0, folded: false, allIn: false, acted: false })),
    p.baseBet,
  );
  let state: Poker7State = {
    game: "poker7",
    handId: p.handId,
    baseBet: p.baseBet,
    phase: "choice",
    street: 3,
    seats,
    round: { high: 0, raises: {}, bossId: seats[0].id, toActId: null },
    cards: [],
    chosen: [],
    result: null,
    secrets: { deck, deckPos: 0, choices: {} },
  };
  for (let i = 0; i < 4; i++) state = dealOneEach(state, false);
  return state;
}

const bySeat = (seats: readonly Seat[]) => [...seats].sort((a, b) => a.seatNo - b.seatNo);
const live = (state: Poker7State) => state.seats.filter((s) => !s.folded);
const cardsOf = (state: Poker7State, id: string) => state.cards.filter((c) => c.ownerId === id);

function dealOneEach(state: Poker7State, faceUp: boolean): Poker7State {
  let pos = state.secrets.deckPos;
  const dealt = bySeat(live(state)).map((s) => ({ ownerId: s.id, faceUp, card: state.secrets.deck[pos++] }));
  return { ...state, cards: [...state.cards, ...dealt], secrets: { ...state.secrets, deckPos: pos } };
}

/** 시간 초과 시 자동 선택 [우리 규칙]: 가장 약한 카드를 버리고, 남은 카드 중 가장 약한 카드를 공개 */
function autoChoice(cards: readonly PokerCard[]): { discard: PokerCard; open: PokerCard } {
  const weakestFirst = [...cards].sort((a, b) => rankOf(a) - rankOf(b) || suitStrength(a) - suitStrength(b));
  return { discard: weakestFirst[0], open: weakestFirst[1] };
}

function choose(state: Poker7State, seatId: string, discard: PokerCard, open: PokerCard): Poker7State {
  if (state.chosen.includes(seatId)) throw new Poker7Error("already chose");
  const mine = cardsOf(state, seatId).map((c) => c.card);
  if (!state.seats.some((s) => s.id === seatId)) throw new Poker7Error("not seated");
  if (discard === open || !mine.includes(discard) || !mine.includes(open)) throw new Poker7Error("bad choice");
  const next: Poker7State = {
    ...state,
    chosen: [...state.chosen, seatId],
    secrets: { ...state.secrets, choices: { ...state.secrets.choices, [seatId]: { discard, open } } },
  };
  return next.chosen.length === next.seats.length ? revealChoices(next) : next;
}

function revealChoices(state: Poker7State): Poker7State {
  const { choices } = state.secrets;
  const cards = state.cards
    .filter((c) => choices[c.ownerId].discard !== c.card)
    .map((c) => (choices[c.ownerId].open === c.card ? { ...c, faceUp: true } : c));
  return beginStreet(dealOneEach({ ...state, cards, street: 4 }, true));
}

/** 이번 구 베팅 시작. 보스 = 오픈 카드가 가장 센 사람 (다이한 사람 제외) */
function beginStreet(state: Poker7State): Poker7State {
  const contenders = live(state);
  let boss = contenders[0];
  let bossHand: PokerHand | null = null;
  for (const s of contenders) {
    const h = openCardsHand(cardsOf(state, s.id).filter((c) => c.faceUp).map((c) => c.card));
    if (!bossHand || compareScores(h.score, bossHand.score) > 0) {
      boss = s;
      bossHand = h;
    }
  }
  const { seats, round } = startRound(state.seats, boss.id);
  const next: Poker7State = { ...state, phase: "bet", seats, round };
  return isRoundOver(round) ? advance(next) : next;
}

function advance(state: Poker7State): Poker7State {
  if (live(state).length <= 1 || state.street === 7) return showdown(state);
  const street = state.street + 1;
  return beginStreet(dealOneEach({ ...state, street }, street !== 7));
}

function showdown(state: Poker7State): Poker7State {
  const players = live(state);
  const reveal = players.length > 1;
  const cards = reveal ? state.cards.map((c) => (players.some((p) => p.id === c.ownerId) ? { ...c, faceUp: true } : c)) : state.cards;
  const hands: Record<string, PokerHand> = {};
  if (reveal) for (const p of players) hands[p.id] = bestHand(cardsOf(state, p.id).map((c) => c.card));

  const pots = computePots(state.seats);
  const winnersOf = (eligible: readonly string[]) => {
    const contenders = eligible.filter((id) => players.some((p) => p.id === id));
    if (contenders.length <= 1) return contenders.length === 1 ? contenders : [...eligible];
    let best: string[] = [];
    for (const id of contenders) {
      const cmp = best.length === 0 ? 1 : compareScores(hands[id].score, hands[best[0]].score);
      if (cmp > 0) best = [id];
      else if (cmp === 0) best.push(id);
    }
    return best;
  };
  const totals = awardPots(pots, state.seats, winnersOf);
  const mainWinners = winnersOf(pots[0].eligible);
  const winnerId = bySeat(state.seats.filter((s) => mainWinners.includes(s.id)))[0].id;
  return {
    ...state,
    phase: "done",
    cards,
    seats: state.seats.map((s) => ({ ...s, stack: s.stack + (totals.get(s.id) ?? 0), handContrib: 0, roundContrib: 0 })),
    round: { ...state.round, toActId: null },
    result: {
      payouts: Object.fromEntries(totals),
      winnerId,
      hands: Object.fromEntries(Object.entries(hands).map(([id, h]) => [id, { category: h.category, cards: h.cards }])),
    },
  };
}

export function reducePoker7(state: Poker7State, action: Poker7Action): Poker7State {
  if (state.phase === "done") throw new Poker7Error("hand is over");
  if (state.phase === "choice") {
    if (action.type === "choose") return choose(state, action.seatId, action.discard, action.open);
    if (action.type === "choice_timeout") {
      return state.seats
        .filter((s) => !state.chosen.includes(s.id))
        .reduce((s, seat) => {
          const pick = autoChoice(cardsOf(s, seat.id).map((c) => c.card));
          return choose(s, seat.id, pick.discard, pick.open);
        }, state);
    }
    throw new Poker7Error("waiting for choices");
  }
  if (action.type === "choose" || action.type === "choice_timeout") throw new Poker7Error("choice is over");
  if (state.round.toActId !== action.seatId) throw new Poker7Error("not your turn");
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

export type Poker7View = Omit<Poker7State, "secrets" | "cards"> & { cards: VisibleCard<PokerCard>[] };

export function viewPoker7(state: Poker7State, viewerId: string | null): Poker7View {
  const { secrets: _secrets, cards, ...rest } = state;
  void _secrets;
  return { ...rest, cards: maskCards(cards, viewerId) };
}
