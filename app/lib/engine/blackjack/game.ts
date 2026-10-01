// 블랙잭 진행 — blackjack-arch.md 결정 2·3·5.
// 베팅(동시) → 딜 → peek → 좌석 순서 턴 → 딜러(리듀서 안에서 한 번에) → done.
// reduce는 순수 함수. 덱과 딜러 히든은 secrets에만 있다.
import { createRng, shuffle, type SeedEntry } from "../rng";
import { MAX_BET } from "../solo/games";
import { SHOE_SIZE, cardValue, handTotal, isNatural, type BjCard } from "./hands";

export type BjPhase = "bet" | "play" | "done";
export type BjOutcome = "blackjack" | "win" | "push" | "lose" | "bust";
export type BjMove = "hit" | "stand" | "double" | "split";

export type BjHand = {
  cards: BjCard[];
  /** 이 손에 걸린 금액 (더블하면 두 배) */
  bet: number;
  doubled: boolean;
  /** 스플릿으로 생긴 손 (2장 21이어도 블랙잭이 아님) */
  split: boolean;
  done: boolean;
  outcome: BjOutcome | null;
};

export type BjSeat = {
  id: string;
  seatNo: number;
  /** 판 시작 스택 */
  startStack: number;
  /** 실시간 스택 = 판 시작 스택 − 걸린 금액 (+ 판 끝 지급) */
  stack: number;
  /** waiting: 아직 안 정함, in: 베팅함, out: 이번 판 불참 */
  status: "waiting" | "in" | "out";
  /** 누적 걸린 금액 (room_seats.hand_contrib과 같아야 한다) */
  committed: number;
  hands: BjHand[];
};

export type BjResult = {
  /** 좌석별 손익 = 최종 스택 − 판 시작 스택 */
  deltas: Record<string, number>;
  dealerTotal: number | null;
};

export type BlackjackState = {
  game: "blackjack";
  handId: string;
  baseBet: number;
  phase: BjPhase;
  seats: BjSeat[];
  dealer: { cards: BjCard[]; holeHidden: boolean };
  toAct: { seatId: string; handIdx: number } | null;
  result: BjResult | null;
  secrets: { deck: BjCard[]; deckPos: number; hole: BjCard | null };
};

export type BlackjackAction =
  | { type: "bet"; seatId: string; amount: number }
  | { type: "sit_out"; seatId: string }
  /** 베팅 기한이 지나면 아직 안 정한 사람은 불참 */
  | { type: "bet_timeout" }
  | { type: "move"; seatId: string; move: BjMove }
  /** 턴 기한이 지나면 스탠드 */
  | { type: "timeout"; seatId: string };

export type CreateBlackjackHand = {
  handId: string;
  baseBet: number;
  seats: { id: string; seatNo: number; stack: number }[];
  serverSeed: string;
  seeds: SeedEntry[];
};

export class BlackjackError extends Error {}

const INITIAL_SHOE: BjCard[] = Array.from({ length: SHOE_SIZE }, (_, i) => i);

export function blackjackDeck(p: Pick<CreateBlackjackHand, "serverSeed" | "handId" | "seeds">): BjCard[] {
  return shuffle(INITIAL_SHOE, createRng({ serverSeed: p.serverSeed, handId: p.handId, rematchNo: 0, seeds: p.seeds }));
}

export function createBlackjackHand(p: CreateBlackjackHand, deck: BjCard[] = blackjackDeck(p)): BlackjackState {
  if (p.seats.length < 1 || p.seats.length > 6) throw new BlackjackError("블랙잭은 1~6명");
  if (!Number.isSafeInteger(p.baseBet) || p.baseBet < 2 || p.baseBet % 2 !== 0) throw new BlackjackError("baseBet must be a positive even integer");
  if (p.seats.some((s) => !Number.isSafeInteger(s.stack) || s.stack < 0)) throw new BlackjackError("bad stack");
  if (new Set(p.seats.map((s) => s.id)).size !== p.seats.length || new Set(p.seats.map((s) => s.seatNo)).size !== p.seats.length) {
    throw new BlackjackError("duplicate seat");
  }
  if (deck.length !== SHOE_SIZE || new Set(deck).size !== SHOE_SIZE || deck.some((c) => !Number.isInteger(c) || c < 0 || c >= SHOE_SIZE)) {
    throw new BlackjackError("deck must use each card 0..311 once");
  }
  return {
    game: "blackjack",
    handId: p.handId,
    baseBet: p.baseBet,
    phase: "bet",
    seats: [...p.seats]
      .sort((a, b) => a.seatNo - b.seatNo)
      .map((s) => ({ id: s.id, seatNo: s.seatNo, startStack: s.stack, stack: s.stack, status: "waiting", committed: 0, hands: [] })),
    dealer: { cards: [], holeHidden: false },
    toAct: null,
    result: null,
    // 넘겨받은 덱은 복사하지 않는다 (호출자가 다시 쓰지 않는 전제, poker7과 같음)
    secrets: { deck, deckPos: 0, hole: null },
  };
}

export function maxBet(state: BlackjackState, seatId: string): number {
  const seat = state.seats.find((s) => s.id === seatId);
  return seat ? Math.min(seat.stack, MAX_BET) : 0;
}

/** 지금 이 사람이 할 수 있는 것 (베팅 단계는 bet·sit_out, 금액은 maxBet로 따로 검사) */
export function legalBlackjack(state: BlackjackState, seatId: string): ("bet" | "sit_out" | BjMove)[] {
  const seat = state.seats.find((s) => s.id === seatId);
  if (!seat) return [];
  if (state.phase === "bet") {
    if (seat.status !== "waiting") return [];
    return maxBet(state, seatId) >= state.baseBet ? ["bet", "sit_out"] : ["sit_out"];
  }
  if (state.phase !== "play" || state.toAct?.seatId !== seatId) return [];
  const hand = seat.hands[state.toAct.handIdx];
  const moves: BjMove[] = ["hit", "stand"];
  const firstTwo = hand.cards.length === 2;
  if (firstTwo && seat.stack >= hand.bet) moves.push("double");
  if (firstTwo && seat.hands.length === 1 && cardValue(hand.cards[0]) === cardValue(hand.cards[1]) && seat.stack >= hand.bet) {
    moves.push("split");
  }
  return moves;
}

// ── 내부 도우미 (모두 새 상태를 돌려준다) ────────────────────────

function draw(state: BlackjackState): [BjCard, BlackjackState] {
  const card = state.secrets.deck[state.secrets.deckPos];
  return [card, { ...state, secrets: { ...state.secrets, deckPos: state.secrets.deckPos + 1 } }];
}

function updateSeat(state: BlackjackState, seatId: string, f: (s: BjSeat) => BjSeat): BlackjackState {
  return { ...state, seats: state.seats.map((s) => (s.id === seatId ? f(s) : s)) };
}

function updateHand(state: BlackjackState, seatId: string, idx: number, f: (h: BjHand) => BjHand): BlackjackState {
  return updateSeat(state, seatId, (s) => ({ ...s, hands: s.hands.map((h, i) => (i === idx ? f(h) : h)) }));
}

function giveCard(state: BlackjackState, seatId: string, idx: number): BlackjackState {
  const [card, next] = draw(state);
  return updateHand(next, seatId, idx, (h) => ({ ...h, cards: [...h.cards, card] }));
}

/** 21 이상이면 손이 저절로 끝난다 */
function closeIfDone(state: BlackjackState, seatId: string, idx: number): BlackjackState {
  return updateHand(state, seatId, idx, (h) => {
    const t = handTotal(h.cards).total;
    if (t > 21) return { ...h, done: true, outcome: "bust" };
    if (t === 21) return { ...h, done: true };
    return h;
  });
}

const isNaturalHand = (seat: BjSeat, h: BjHand) => !h.split && seat.hands.length === 1 && isNatural(h.cards);

function nextActor(state: BlackjackState): BlackjackState["toAct"] {
  for (const s of state.seats) {
    const idx = s.hands.findIndex((h) => !h.done);
    if (idx >= 0) return { seatId: s.id, handIdx: idx };
  }
  return null;
}

function decideBet(state: BlackjackState, seatId: string, amount: number | null): BlackjackState {
  if (state.phase !== "bet") throw new BlackjackError("betting is over");
  const seat = state.seats.find((s) => s.id === seatId);
  if (!seat) throw new BlackjackError("not seated");
  if (seat.status !== "waiting") throw new BlackjackError("already decided");
  let next: BlackjackState;
  if (amount === null) {
    next = updateSeat(state, seatId, (s) => ({ ...s, status: "out" }));
  } else {
    if (!Number.isSafeInteger(amount) || amount % 2 !== 0 || amount < state.baseBet || amount > maxBet(state, seatId)) {
      throw new BlackjackError("bad bet amount");
    }
    next = updateSeat(state, seatId, (s) => ({
      ...s,
      status: "in",
      stack: s.stack - amount,
      committed: amount,
      hands: [{ cards: [], bet: amount, doubled: false, split: false, done: false, outcome: null }],
    }));
  }
  return next.seats.every((s) => s.status !== "waiting") ? deal(next) : next;
}

function deal(state: BlackjackState): BlackjackState {
  const players = state.seats.filter((s) => s.status === "in");
  if (players.length === 0) return settle({ ...state, phase: "done" }, null);
  let s: BlackjackState = { ...state, phase: "play" };
  for (const p of players) s = giveCard(s, p.id, 0);
  const [up, s1] = draw(s);
  s = { ...s1, dealer: { cards: [up], holeHidden: true } };
  for (const p of players) s = giveCard(s, p.id, 0);
  const [hole, s2] = draw(s);
  s = { ...s2, secrets: { ...s2.secrets, hole } };

  // peek: 오픈이 A나 10점이면 딜러 블랙잭 확인 → 블랙잭이면 바로 정산
  const upValue = cardValue(up);
  if ((upValue === 1 || upValue === 10) && isNatural([up, hole])) {
    return settle(revealHole(s), 21);
  }
  // 참가자 블랙잭은 턴 없이 확정
  for (const p of players) {
    const seat = s.seats.find((x) => x.id === p.id)!;
    if (isNaturalHand(seat, seat.hands[0])) s = updateHand(s, p.id, 0, (h) => ({ ...h, done: true }));
  }
  return advance(s);
}

function revealHole(state: BlackjackState): BlackjackState {
  const hole = state.secrets.hole!;
  return { ...state, dealer: { cards: [...state.dealer.cards, hole], holeHidden: false }, secrets: { ...state.secrets, hole: null } };
}

function advance(state: BlackjackState): BlackjackState {
  let s = state;
  for (;;) {
    const toAct = nextActor(s);
    if (!toAct) return dealerPlay({ ...s, toAct: null });
    const hand = s.seats.find((x) => x.id === toAct.seatId)!.hands[toAct.handIdx];
    if (hand.cards.length >= 2) return { ...s, toAct };
    // 스플릿한 손은 차례가 왔을 때 두 번째 카드를 받는다 (21이면 저절로 끝나고 다음으로)
    s = closeIfDone(giveCard(s, toAct.seatId, toAct.handIdx), toAct.seatId, toAct.handIdx);
  }
}

function dealerPlay(state: BlackjackState): BlackjackState {
  let s = revealHole(state);
  // 버스트도 블랙잭도 아닌 손이 있을 때만 받는다. 17 이상이면 멈춘다 (소프트 17 포함)
  const contested = s.seats.some((seat) => seat.hands.some((h) => h.outcome !== "bust" && !isNaturalHand(seat, h)));
  if (contested) {
    while (handTotal(s.dealer.cards).total < 17) {
      const [card, next] = draw(s);
      s = { ...next, dealer: { ...next.dealer, cards: [...next.dealer.cards, card] } };
    }
  }
  return settle(s, handTotal(s.dealer.cards).total);
}

/** dealerTotal: 딜러 최종 점수 (딜러 블랙잭이면 21이고 peek에서 바로 온다), null = 아무도 안 걸어 딜 없음 */
function settle(state: BlackjackState, dealerTotal: number | null): BlackjackState {
  const dealerNatural = dealerTotal !== null && isNatural(state.dealer.cards);
  const seats = state.seats.map((seat) => {
    let paid = 0;
    const hands = seat.hands.map((h) => {
      let outcome: BjOutcome;
      if (h.outcome === "bust") outcome = "bust";
      else if (isNaturalHand(seat, h)) outcome = dealerNatural ? "push" : "blackjack";
      else if (dealerNatural) outcome = "lose";
      else {
        const t = handTotal(h.cards).total;
        const d = dealerTotal!;
        outcome = d > 21 || t > d ? "win" : t === d ? "push" : "lose";
      }
      paid += outcome === "blackjack" ? h.bet + (h.bet * 3) / 2 : outcome === "win" ? h.bet * 2 : outcome === "push" ? h.bet : 0;
      return { ...h, done: true, outcome };
    });
    return { ...seat, hands, stack: seat.stack + paid };
  });
  return {
    ...state,
    phase: "done",
    seats,
    toAct: null,
    result: { deltas: Object.fromEntries(seats.map((s) => [s.id, s.stack - s.startStack])), dealerTotal },
  };
}

function move(state: BlackjackState, seatId: string, m: BjMove): BlackjackState {
  if (!legalBlackjack(state, seatId).includes(m)) throw new BlackjackError(`illegal move ${m}`);
  const idx = state.toAct!.handIdx;
  const hand = state.seats.find((s) => s.id === seatId)!.hands[idx];
  let s = state;
  switch (m) {
    case "stand":
      s = updateHand(s, seatId, idx, (h) => ({ ...h, done: true }));
      break;
    case "hit":
      s = closeIfDone(giveCard(s, seatId, idx), seatId, idx);
      break;
    case "double":
      s = updateSeat(s, seatId, (x) => ({ ...x, stack: x.stack - hand.bet, committed: x.committed + hand.bet }));
      s = updateHand(s, seatId, idx, (h) => ({ ...h, bet: h.bet * 2, doubled: true }));
      s = closeIfDone(giveCard(s, seatId, idx), seatId, idx);
      s = updateHand(s, seatId, idx, (h) => ({ ...h, done: true }));
      break;
    case "split": {
      const [a, b] = hand.cards;
      const aces = cardValue(a) === 1;
      s = updateSeat(s, seatId, (x) => ({
        ...x,
        stack: x.stack - hand.bet,
        committed: x.committed + hand.bet,
        hands: [a, b].map((c) => ({ cards: [c], bet: hand.bet, doubled: false, split: true, done: false, outcome: null })),
      }));
      // A를 나누면 지금 1장씩만 받고 끝. 나머지는 손마다 차례가 오면 받는다 (advance)
      if (aces) for (const i of [0, 1]) s = updateHand(giveCard(s, seatId, i), seatId, i, (h) => ({ ...h, done: true }));
      break;
    }
  }
  return advance(s);
}

export function reduceBlackjack(state: BlackjackState, action: BlackjackAction): BlackjackState {
  if (state.phase === "done") throw new BlackjackError("hand is over");
  switch (action.type) {
    case "bet":
      return decideBet(state, action.seatId, action.amount);
    case "sit_out":
      return decideBet(state, action.seatId, null);
    case "bet_timeout":
      if (state.phase !== "bet") throw new BlackjackError("betting is over");
      return state.seats.filter((s) => s.status === "waiting").reduce((s, seat) => decideBet(s, seat.id, null), state);
    case "move":
      if (state.phase !== "play") throw new BlackjackError("not playing");
      return move(state, action.seatId, action.move);
    case "timeout":
      if (state.phase !== "play" || state.toAct?.seatId !== action.seatId) throw new BlackjackError("not your turn");
      return move(state, action.seatId, "stand");
  }
}

export type BlackjackView = Omit<BlackjackState, "secrets">;

/** 참가자 카드는 전부 공개. 숨길 것은 덱과 딜러 히든뿐이다 */
export function viewBlackjack(state: BlackjackState): BlackjackView {
  const { secrets: _secrets, ...rest } = state;
  void _secrets;
  return rest;
}
