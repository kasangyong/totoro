"use client";

import { useState } from "react";
import type { BjHand, BjOutcome, BjSeat, BlackjackView } from "@/lib/engine/blackjack/game";
import { handTotal } from "@/lib/engine/blackjack/hands";
import { MAX_BET } from "@/lib/engine/solo/games";
import type { RoomView } from "@/lib/rooms/service";
import { PlayingCard } from "./playing-card";

// 블랙잭 무대 — blackjack-arch.md 결정 7. 방 화면(room-table.tsx)의 틀 안에 들어간다.

const OUTCOME: Record<BjOutcome, { label: string; tone: string }> = {
  blackjack: { label: "블랙잭", tone: "border-win text-win" },
  win: { label: "승", tone: "border-win text-win" },
  push: { label: "무승부", tone: "border-line text-muted" },
  lose: { label: "패", tone: "border-bust/70 text-bust" },
  bust: { label: "버스트", tone: "border-bust/70 text-bust" },
};

const MOVE_LABEL = { hit: "히트", stand: "스탠드", double: "더블", split: "스플릿" } as const;

export function totalLabel(cards: readonly number[]): string {
  if (cards.length === 0) return "";
  const { total, soft } = handTotal(cards);
  return soft && total < 21 ? `소프트 ${total}` : String(total);
}

/** 카드 여러 장을 한 줄에 (많으면 겹쳐서) */
function Cards({ cards, small, hidden = 0 }: { cards: readonly number[]; small?: boolean; hidden?: number }) {
  const all: (number | null)[] = [...cards, ...Array<null>(hidden).fill(null)];
  const overlap = small ? (all.length > 3 ? "-ml-6" : "ml-1") : all.length > 3 ? "-ml-9" : "ml-1.5";
  return (
    <div className="flex">
      {all.map((c, i) => (
        <div key={i} className={i === 0 ? "" : overlap}>
          <PlayingCard card={c} small={small} />
        </div>
      ))}
    </div>
  );
}

function Outcome({ outcome }: { outcome: BjOutcome | null }) {
  if (!outcome) return null;
  const o = OUTCOME[outcome];
  return <span className={`rounded border px-1.5 py-0.5 text-[11px] ${o.tone}`}>{o.label}</span>;
}

function HandBox({ hand, small, active }: { hand: BjHand; small?: boolean; active?: boolean }) {
  return (
    <div className={`rounded-lg p-1.5 ${active ? "bg-accent/15 ring-1 ring-accent" : ""}`}>
      <Cards cards={hand.cards} small={small} />
      <div className="mt-1 flex items-center gap-1.5 text-xs">
        <span className="font-display text-sm">{totalLabel(hand.cards)}</span>
        <span className="text-muted">
          {hand.bet.toLocaleString("ko-KR")}P{hand.doubled ? " · 더블" : ""}
        </span>
        <Outcome outcome={hand.outcome} />
      </div>
    </div>
  );
}

export function BjDealer({ game }: { game: BlackjackView }) {
  const d = game.dealer;
  return (
    <div className="flex shrink-0 flex-col items-center gap-1 lg:w-48">
      <p className="text-xs text-muted">
        딜러{d.cards.length > 0 && ` · ${d.holeHidden ? `${totalLabel(d.cards)} + ?` : totalLabel(d.cards)}`}
      </p>
      <div className="flex min-h-[72px] items-center">
        {d.cards.length > 0 ? (
          <Cards cards={d.cards} small hidden={d.holeHidden ? 1 : 0} />
        ) : game.phase === "bet" ? (
          <span className="text-xs text-muted">베팅이 끝나면 카드를 돌려요</span>
        ) : (
          <span className="text-xs text-muted">이번 판은 아무도 안 걸었어요</span>
        )}
      </div>
    </div>
  );
}

/** 다른 사람 자리 (작은 카드) */
export function BjOthers({ view, game, badges }: { view: RoomView; game: BlackjackView | null; badges: (userId: string, turn: boolean) => React.ReactNode }) {
  const others = view.seats.filter((s) => s.userId !== view.me);
  return (
    <ul className="grid min-h-0 flex-1 auto-rows-min content-start gap-2 overflow-auto sm:grid-cols-2 xl:grid-cols-3">
      {others.map((s) => {
        const gs = game?.seats.find((x) => x.id === s.userId);
        const turn = game?.toAct?.seatId === s.userId;
        return (
          <li key={s.userId} className={`rounded-xl border p-2.5 ${turn ? "border-accent bg-accent/10" : "border-line bg-black/20"} ${gs?.status === "out" ? "opacity-60" : ""}`}>
            <div className="flex items-center justify-between gap-2">
              <p className="truncate text-sm font-bold">{s.username}</p>
              <span className="font-display">{s.stack.toLocaleString("ko-KR")}</span>
            </div>
            <div className="mt-1 flex flex-wrap gap-1 text-[11px] empty:hidden">
              {badges(s.userId, turn)}
              {gs && <SeatStatus seat={gs} phase={game!.phase} />}
            </div>
            <div className="flex flex-wrap gap-1">
              {gs?.hands.map((h, i) => <HandBox key={i} hand={h} small active={turn && game!.toAct!.handIdx === i} />)}
            </div>
          </li>
        );
      })}
      {others.length === 0 && <li className="text-sm text-muted">혼자서도 딜러와 할 수 있어요. 친구를 부르려면 방 주소를 보내 주세요.</li>}
    </ul>
  );
}

function SeatStatus({ seat, phase }: { seat: BjSeat; phase: BlackjackView["phase"] }) {
  if (phase !== "bet") return seat.status === "out" ? <span className="rounded border border-line px-1.5 py-0.5 text-muted">쉼</span> : null;
  const label = seat.status === "waiting" ? "베팅 고르는 중" : seat.status === "in" ? `${seat.committed.toLocaleString("ko-KR")}P 베팅` : "이번 판 쉼";
  return <span className="rounded border border-line px-1.5 py-0.5 text-muted">{label}</span>;
}

/** 내 손 + 베팅·수 버튼 */
export function BjMine({ view, game, busy, run }: { view: RoomView; game: BlackjackView; busy: boolean; run: (op: string, body: unknown) => void }) {
  const seat = game.seats.find((s) => s.id === view.me);
  const base = game.baseBet;
  const max = seat ? Math.min(seat.stack, MAX_BET) : 0;
  const [amount, setAmount] = useState(base);
  const even = (n: number) => Math.max(base, Math.min(max - (max % 2), Math.floor(n / 2) * 2));
  const canBet = view.legal.includes("bet");
  const validAmount = Number.isSafeInteger(amount) && amount % 2 === 0 && amount >= base && amount <= max;
  const moves = view.legal.filter((a): a is keyof typeof MOVE_LABEL => a in MOVE_LABEL);

  if (!seat) return null;
  if (game.phase === "bet") {
    if (!view.legal.includes("sit_out")) {
      return <p className="mt-2 text-center text-sm text-muted">{seat.status === "in" ? `${seat.committed.toLocaleString("ko-KR")}P 걸었어요. 다른 사람을 기다려요.` : "이번 판은 쉬어요."}</p>;
    }
    return (
      <div className="mt-2 grid gap-2">
        <div className="flex flex-wrap items-center justify-center gap-1.5">
          {[1, 2, 5, 10].map((m) => (
            <button
              key={m}
              type="button"
              className="btn-ghost px-3 py-1.5 text-sm aria-pressed:border-accent aria-pressed:text-accent"
              aria-label={`${(base * m).toLocaleString("ko-KR")}P로 정하기`}
              aria-pressed={amount === base * m}
              disabled={busy || base * m > max}
              onClick={() => setAmount(even(base * m))}
            >
              {(base * m).toLocaleString("ko-KR")}
            </button>
          ))}
          <label className="flex items-center gap-1 text-sm">
            <input
              className="field w-28 py-1.5"
              type="number"
              aria-label="베팅 금액"
              min={base}
              max={max}
              step={2}
              value={amount}
              onChange={(e) => setAmount(Number(e.target.value))}
            />
            P
          </label>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <button className="btn-main py-2.5 text-base" disabled={busy || !canBet || !validAmount} onClick={() => run("act", { action: "bet", amount, expectedSeq: view.seq })}>
            베팅
          </button>
          <button className="btn-main py-2.5 text-base" disabled={busy} onClick={() => run("act", { action: "sit_out", expectedSeq: view.seq })}>
            이번 판 쉬기
          </button>
        </div>
        <p className="text-center text-[11px] text-muted">
          {base.toLocaleString("ko-KR")}~{max.toLocaleString("ko-KR")}P, 짝수로 (블랙잭 3:2를 정확히 주려고요)
        </p>
      </div>
    );
  }
  return (
    <div className="mt-2 grid gap-2">
      <div className="flex min-h-24 flex-wrap justify-center gap-3 sm:min-h-32">
        {seat.hands.map((h, i) => (
          <HandBox key={i} hand={h} active={game.toAct?.seatId === view.me && game.toAct.handIdx === i && seat.hands.length > 1} />
        ))}
        {seat.status === "out" && <p className="self-center text-sm text-muted">이번 판은 쉬어요.</p>}
      </div>
      {moves.length > 0 && (
        <div className="grid grid-cols-4 gap-2">
          {moves.map((m) => (
            <button key={m} className="btn-main py-2.5 text-base" disabled={busy} onClick={() => run("act", { action: m, expectedSeq: view.seq })}>
              {MOVE_LABEL[m]}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** 판 결과 줄: 딜러 점수와 좌석별 손익 */
export function BjResultLine({ view, game }: { view: RoomView; game: BlackjackView }) {
  const r = game.result!;
  const name = (id: string) => view.seats.find((s) => s.userId === id)?.username ?? id.slice(0, 6);
  const dealer = r.dealerTotal === null ? "아무도 안 걸었어요" : game.dealer.cards.length === 2 && r.dealerTotal === 21 ? "딜러 블랙잭" : r.dealerTotal > 21 ? "딜러 버스트" : `딜러 ${r.dealerTotal}`;
  const deltas = Object.entries(r.deltas).filter(([id]) => game.seats.find((s) => s.id === id)?.status === "in");
  return (
    <p>
      <b className="text-accent">{dealer}</b>
      <span className="ml-2 text-muted">
        {deltas
          .map(([id, d]) => `${name(id)} ${d > 0 ? "+" : d < 0 ? "−" : "±"}${Math.abs(d).toLocaleString("ko-KR")}P`)
          .join(" · ")}
      </span>
    </p>
  );
}

/** 오른쪽 패널: 규칙 요약 + 지금 내 점수 */
export function BjRules({ myTotal }: { myTotal: string | null }) {
  const rows = [
    ["블랙잭 (A + 10점 카드)", "3:2"],
    ["이기면", "1:1"],
    ["비기면", "돌려받음"],
  ];
  return (
    <aside className="panel p-3 text-[11px] leading-4" aria-label="블랙잭 규칙">
      {myTotal && (
        <p className="mb-2 rounded bg-accent px-2 py-1 text-sm font-bold text-[var(--accent-ink)]">
          내 점수 {myTotal}
        </p>
      )}
      <p className="mb-1 text-xs font-bold text-accent">21에 가까우면 이겨요</p>
      <ul className="grid gap-0.5 text-muted">
        <li>A는 1 또는 11, J·Q·K는 10</li>
        <li>22 이상이면 버스트 (바로 패배)</li>
        <li>딜러는 17 이상이 될 때까지 받고, 소프트 17에서도 멈춰요</li>
      </ul>
      <p className="mt-2 mb-1 text-xs font-bold text-accent">지급</p>
      <ul className="grid gap-0.5">
        {rows.map(([k, v]) => (
          <li key={k} className="flex justify-between text-muted">
            <span>{k}</span>
            <span className="font-bold text-fg">{v}</span>
          </li>
        ))}
      </ul>
      <p className="mt-2 mb-1 text-xs font-bold text-accent">할 수 있는 것</p>
      <ul className="grid gap-0.5 text-muted">
        <li><b className="text-fg">히트</b> 한 장 더 · <b className="text-fg">스탠드</b> 멈춤</li>
        <li><b className="text-fg">더블</b> 처음 2장일 때 두 배로 걸고 한 장만</li>
        <li><b className="text-fg">스플릿</b> 같은 점수 2장을 두 손으로 (1번, A는 한 장씩만)</li>
      </ul>
      <p className="mt-2 text-muted">딜러 오픈이 A나 10이면 블랙잭인지 먼저 확인해요. 실력이 들어가는 게임이라 잘하면 환급률이 약 99.5%예요.</p>
      <p className="mt-1 text-bust/90">판 도중 10분 넘게 아무도 없으면 건 돈은 잃어요.</p>
    </aside>
  );
}
