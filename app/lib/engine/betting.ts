// 한국식 팟 베팅 — docs/design/card-games-rules.md "공통 베팅". 모든 함수는 입력을 바꾸지 않고 새 값을 돌려준다.

/** [우리 규칙] 한 라운드에 한 사람이 할 수 있는 레이즈(따당·쿼터·하프) 횟수 */
export const MAX_RAISES_PER_SEAT = 2;

export type Seat = {
  id: string;
  seatNo: number;
  stack: number;
  handContrib: number;
  roundContrib: number;
  folded: boolean;
  allIn: boolean;
  acted: boolean;
};

export type Round = {
  high: number;
  /** 이번 라운드에 좌석별로 한 레이즈 횟수 */
  raises: Record<string, number>;
  bossId: string;
  toActId: string | null;
};

export type BetActionType = "check" | "ping" | "call" | "ddadang" | "quarter" | "half" | "die";

const RAISES: ReadonlySet<BetActionType> = new Set(["ddadang", "quarter", "half"]);

export class BettingError extends Error {}

export function potTotal(seats: readonly Seat[]): number {
  return seats.reduce((sum, s) => sum + s.handContrib, 0);
}

function bySeatNo(seats: readonly Seat[]): Seat[] {
  return [...seats].sort((a, b) => a.seatNo - b.seatNo);
}

function canAct(s: Seat): boolean {
  return !s.folded && !s.allIn;
}

function pay(seat: Seat, amount: number): Seat {
  const paid = Math.min(amount, seat.stack);
  return {
    ...seat,
    stack: seat.stack - paid,
    handContrib: seat.handContrib + paid,
    roundContrib: seat.roundContrib + paid,
    allIn: seat.allIn || seat.stack - paid === 0,
  };
}

export function postAntes(seats: readonly Seat[], baseBet: number): Seat[] {
  return seats.map((s) => {
    const paid = Math.min(baseBet, s.stack);
    return { ...s, stack: s.stack - paid, handContrib: s.handContrib + paid, allIn: s.stack - paid === 0 };
  });
}

function needsAction(s: Seat, round: Round): boolean {
  return canAct(s) && (!s.acted || s.roundContrib < round.high);
}

function roundOver(seats: readonly Seat[], round: Round): boolean {
  const live = seats.filter((s) => !s.folded);
  if (live.length <= 1) return true;
  const actors = seats.filter(canAct);
  if (actors.length === 0) return true;
  if (actors.length === 1 && actors[0].roundContrib >= round.high) return true;
  return !seats.some((s) => needsAction(s, round));
}

function nextActor(seats: readonly Seat[], round: Round, afterSeatNo: number, inclusive: boolean): string | null {
  if (roundOver(seats, round)) return null;
  const ordered = bySeatNo(seats);
  const start = ordered.findIndex((s) => (inclusive ? s.seatNo >= afterSeatNo : s.seatNo > afterSeatNo));
  for (let k = 0; k < ordered.length; k++) {
    const s = ordered[((start < 0 ? 0 : start) + k) % ordered.length];
    if (needsAction(s, round)) return s.id;
  }
  return null;
}

export function startRound(seats: readonly Seat[], bossId: string): { seats: Seat[]; round: Round } {
  const boss = seats.find((s) => s.id === bossId);
  if (!boss) throw new BettingError("boss not seated");
  const reset = seats.map((s) => ({ ...s, roundContrib: 0, acted: false }));
  const round: Round = { high: 0, raises: {}, bossId, toActId: null };
  round.toActId = nextActor(reset, round, boss.seatNo, true);
  // 지정된 보스가 다이·올인이면 그 라운드에 처음 액션하는 사람이 보스(삥 권한)를 넘겨받는다.
  if (round.toActId !== null) round.bossId = round.toActId;
  return { seats: reset, round };
}

export function isRoundOver(round: Round): boolean {
  return round.toActId === null;
}

function raiseTarget(seats: readonly Seat[], round: Round, seat: Seat, ratio: number): number {
  const potAfterCall = potTotal(seats) + (round.high - seat.roundContrib);
  return round.high + Math.max(1, Math.floor(potAfterCall * ratio));
}

export function legalActions(seats: readonly Seat[], round: Round, seatId: string): BetActionType[] {
  if (round.toActId !== seatId) return [];
  const seat = seats.find((s) => s.id === seatId);
  if (!seat || !canAct(seat)) return [];
  const owed = round.high - seat.roundContrib;
  const actions: BetActionType[] = [];
  if (round.high === 0) {
    actions.push("check");
    if (seatId === round.bossId) actions.push("ping");
  } else {
    actions.push("call");
  }
  const someoneCanRespond = seats.some((s) => s.id !== seatId && canAct(s));
  if ((round.raises[seatId] ?? 0) < MAX_RAISES_PER_SEAT && seat.stack > owed && someoneCanRespond) {
    if (round.high > 0) actions.push("ddadang");
    actions.push("quarter", "half");
  }
  actions.push("die");
  return actions;
}

export function applyAction(
  seats: readonly Seat[],
  round: Round,
  seatId: string,
  action: BetActionType,
  baseBet: number,
): { seats: Seat[]; round: Round } {
  if (!legalActions(seats, round, seatId).includes(action)) {
    throw new BettingError(`illegal action ${action} for ${seatId}`);
  }
  const seat = seats.find((s) => s.id === seatId)!;
  let target: number;
  switch (action) {
    case "check":
    case "die":
      target = seat.roundContrib;
      break;
    case "ping":
      target = baseBet;
      break;
    case "call":
      target = round.high;
      break;
    case "ddadang":
      target = round.high * 2;
      break;
    case "quarter":
      target = raiseTarget(seats, round, seat, 1 / 4);
      break;
    case "half":
      target = raiseTarget(seats, round, seat, 1 / 2);
      break;
  }

  let updated: Seat = action === "die" ? { ...seat, folded: true } : pay(seat, target - seat.roundContrib);
  updated = { ...updated, acted: true };

  const high = Math.max(round.high, updated.roundContrib);
  const raised = high > round.high;
  const nextSeats = seats.map((s) => {
    if (s.id === seatId) return updated;
    return raised && canAct(s) ? { ...s, acted: false } : s;
  });
  const nextRound: Round = {
    ...round,
    high,
    raises: RAISES.has(action) ? { ...round.raises, [seatId]: (round.raises[seatId] ?? 0) + 1 } : round.raises,
    toActId: null,
  };
  nextRound.toActId = nextActor(nextSeats, nextRound, seat.seatNo, false);
  return { seats: nextSeats, round: nextRound };
}

export type Pot = { amount: number; eligible: string[] };

export function computePots(seats: readonly Seat[]): Pot[] {
  const live = seats.filter((s) => !s.folded);
  const levels = [...new Set(live.map((s) => s.handContrib).filter((c) => c > 0))].sort((a, b) => a - b);
  const pots: Pot[] = [];
  let prev = 0;
  for (const level of levels) {
    const amount = seats.reduce((sum, s) => sum + Math.min(s.handContrib, level) - Math.min(s.handContrib, prev), 0);
    const eligible = live.filter((s) => s.handContrib >= level).map((s) => s.id);
    if (amount > 0) pots.push({ amount, eligible });
    prev = level;
  }
  const leftover = seats.reduce((sum, s) => sum + Math.max(0, s.handContrib - prev), 0);
  if (leftover > 0) {
    if (pots.length === 0) throw new BettingError("contributions without live players");
    pots[pots.length - 1] = { ...pots[pots.length - 1], amount: pots[pots.length - 1].amount + leftover };
  }
  return pots;
}

export function splitPot(amount: number, winnerIds: readonly string[], seats: readonly Seat[]): Map<string, number> {
  if (winnerIds.length === 0) throw new BettingError("pot without winners");
  const winners = bySeatNo(seats.filter((s) => winnerIds.includes(s.id)));
  if (winners.length !== new Set(winnerIds).size) throw new BettingError("winner not seated");
  const share = Math.floor(amount / winners.length);
  const payouts = new Map<string, number>();
  winners.forEach((w, i) => payouts.set(w.id, share + (i === 0 ? amount - share * winners.length : 0)));
  return payouts;
}

export function awardPots(
  pots: readonly Pot[],
  seats: readonly Seat[],
  winnersOf: (eligible: readonly string[], potIndex: number) => string[],
): Map<string, number> {
  const totals = new Map<string, number>();
  for (const [i, pot] of pots.entries()) {
    const winners = winnersOf(pot.eligible, i);
    if (winners.some((id) => !pot.eligible.includes(id))) throw new BettingError("winner not eligible for pot");
    for (const [id, amt] of splitPot(pot.amount, winners, seats)) {
      totals.set(id, (totals.get(id) ?? 0) + amt);
    }
  }
  return totals;
}
