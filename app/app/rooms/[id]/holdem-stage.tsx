"use client";

import { useState } from "react";
import { raiseBounds, type HoldemPhase, type HoldemView } from "@/lib/engine/holdem/game";
import { currentHoldemCategory, HOLDEM_CATEGORIES } from "@/lib/engine/holdem/hands";
import type { RoomView } from "@/lib/rooms/service";
import { PlayingCard } from "./playing-card";

// 홀덤 무대 — holdem-arch.md 결정 5. 방 화면(room-table.tsx)의 틀 안에 들어간다.

export const STREET_LABEL: Record<HoldemPhase, string> = {
  preflop: "프리플랍",
  flop: "플랍",
  turn: "턴",
  river: "리버",
  done: "쇼다운",
};

const holesOf = (game: HoldemView, id: string) => game.holes.filter((h) => h.ownerId === id);

/** 지금 내 족보: 개인 2장 + 깔린 공용 카드 */
export function myHoldemCategory(game: HoldemView, me: string) {
  const mine = holesOf(game, me)
    .map((h) => h.card)
    .filter((c): c is number => c !== null);
  return mine.length === 2 ? currentHoldemCategory([...mine, ...game.board]) : null;
}

function Badge({ children, tone }: { children: React.ReactNode; tone?: "accent" | "bust" | "win" }) {
  const cls = tone === "accent" ? "border-accent text-accent" : tone === "bust" ? "border-bust/70 text-bust" : tone === "win" ? "border-win text-win" : "border-line text-muted";
  return <span className={`rounded border px-1.5 py-0.5 ${cls}`}>{children}</span>;
}

/** D·SB·BB·폴드·올인·족보 배지 (내 자리·남의 자리 공통, room-table의 seatBadges가 붙여 쓴다. 차례 배지는 seatBadges가 따로) */
export function HdTags({ game, id }: { game: HoldemView; id: string }) {
  const s = game.seats.find((x) => x.id === id);
  if (!s) return null;
  const hand = game.result?.hands[id];
  const net = game.phase === "done" ? s.stack - (s.startStack ?? s.stack) : 0;
  return (
    <>
      {game.buttonId === id && <Badge tone="accent">D</Badge>}
      {game.sbId === id && <Badge>SB</Badge>}
      {game.bbId === id && <Badge>BB</Badge>}
      {s.folded && <Badge tone="bust">폴드</Badge>}
      {s.allIn && !s.folded && <Badge tone="accent">올인</Badge>}
      {hand && <Badge tone={net > 0 ? "win" : undefined}>{hand.category}</Badge>}
    </>
  );
}

/** 가운데: 공용 카드 5칸 */
export function HdBoard({ game }: { game: HoldemView }) {
  return (
    <div className="flex shrink-0 flex-col items-center gap-1 lg:w-72">
      <p className="text-xs text-muted">공용 카드 · {STREET_LABEL[game.phase]}</p>
      <div className="flex gap-1">
        {Array.from({ length: 5 }, (_, i) =>
          game.board[i] !== undefined ? (
            <PlayingCard key={i} card={game.board[i]} small />
          ) : (
            <div key={i} aria-hidden className="h-[72px] w-[50px] rounded-md border-2 border-dashed border-line/60" />
          ),
        )}
      </div>
    </div>
  );
}

/** 다른 사람 자리 */
export function HdOthers({ view, game, badges }: { view: RoomView; game: HoldemView | null; badges: (userId: string, turn: boolean) => React.ReactNode }) {
  const others = view.seats.filter((s) => s.userId !== view.me);
  return (
    <ul className="grid min-h-0 flex-1 auto-rows-min content-start gap-2 overflow-auto sm:grid-cols-2 xl:grid-cols-3">
      {others.map((s) => {
        const gs = game?.seats.find((x) => x.id === s.userId);
        const turn = game?.toActId === s.userId;
        const cards = game ? holesOf(game, s.userId) : [];
        return (
          <li key={s.userId} className={`rounded-xl border p-2.5 ${turn ? "border-accent bg-accent/10" : "border-line bg-black/20"} ${gs?.folded ? "opacity-60" : ""}`}>
            <div className="flex items-center justify-between gap-2">
              <p className="truncate text-sm font-bold">{s.username}</p>
              <span className="font-display">{s.stack.toLocaleString("ko-KR")}</span>
            </div>
            <div className="mt-1 flex flex-wrap gap-1 text-[11px] empty:hidden">
              {badges(s.userId, turn)}
            </div>
            <div className="mt-1 flex items-end gap-2">
              <div className="flex gap-1">
                {cards.map((c, i) => (
                  <PlayingCard key={i} card={c.card} small />
                ))}
              </div>
              {gs && gs.streetContrib > 0 && game?.phase !== "done" && (
                <span className="text-xs text-muted">이번 라운드 {gs.streetContrib.toLocaleString("ko-KR")}P</span>
              )}
            </div>
          </li>
        );
      })}
      {others.length === 0 && <li className="text-sm text-muted">아직 다른 사람이 없어요. 방 주소를 친구에게 보내 주세요.</li>}
    </ul>
  );
}

/** 내 자리: 개인 카드 크게 + 베팅 버튼 */
export function HdMine({ view, game, busy, run }: { view: RoomView; game: HoldemView; busy: boolean; run: (op: string, body: unknown) => void }) {
  const me = view.me;
  const seat = game.seats.find((s) => s.id === me);
  // raiseBounds는 공개 정보(최고액·최소 증가분·스택)만 쓴다
  const bounds = view.legal.includes("raise") ? raiseBounds(game, me) : null;
  const [amount, setAmount] = useState<number | null>(null);
  if (!seat) return null;
  const toCall = game.currentBet - seat.streetContrib;
  const pot = game.seats.reduce((a, s) => a + s.handContrib, 0);
  // 아직 금액을 안 정했으면 최소 레이즈. 입력한 값은 고치지 않고 그대로 검사한다 (범위 밖이면 버튼이 꺼진다)
  const raiseTo = bounds ? (amount ?? bounds.min) : 0;
  const quick = bounds
    ? [
        { label: "최소", v: bounds.min },
        { label: "½ 팟", v: game.currentBet + Math.floor((pot + toCall) / 2) },
        { label: "팟", v: game.currentBet + pot + toCall },
        { label: "최대", v: bounds.max },
      ].map((q) => ({ ...q, v: Math.min(bounds.max, Math.max(bounds.min, q.v)) }))
    : [];
  const valid = bounds !== null && Number.isSafeInteger(raiseTo) && raiseTo >= bounds.min && raiseTo <= bounds.max;
  const act = (action: string, extra: Record<string, number> = {}) => run("act", { action, expectedSeq: view.seq, ...extra });
  const category = myHoldemCategory(game, me);
  return (
    // 데스크톱은 내 카드 | 조작을 가로로 (세로 공간 절약)
    <div className="mt-2 grid gap-2 lg:flex lg:items-center lg:gap-4">
      <div className="flex min-h-24 shrink-0 items-center justify-center gap-2 sm:min-h-32">
        {holesOf(game, me).map((h, i) => (
          <PlayingCard key={i} card={h.card} />
        ))}
        {category && game.phase !== "done" && <span className="ml-2 rounded bg-accent px-2 py-0.5 text-sm font-bold text-[var(--accent-ink)]">{category}</span>}
      </div>
      {view.legal.length > 0 && (
        <div className="grid gap-2 lg:flex-1">
          {bounds && (
            <div className="flex flex-wrap items-center justify-center gap-1.5">
              {quick.map((q) => (
                <button
                  key={q.label}
                  type="button"
                  className="btn-ghost px-2.5 py-1 text-sm aria-pressed:border-accent aria-pressed:text-accent"
                  aria-pressed={amount === q.v}
                  aria-label={`${q.label} ${q.v.toLocaleString("ko-KR")}P로 정하기`}
                  disabled={busy}
                  onClick={() => setAmount(q.v)}
                >
                  {q.label}
                </button>
              ))}
              <input
                className="field w-28 py-1"
                type="number"
                aria-label="레이즈 총액"
                min={bounds.min}
                max={bounds.max}
                value={amount ?? bounds.min}
                onChange={(e) => setAmount(Number(e.target.value))}
              />
            </div>
          )}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {view.legal.includes("fold") && (
              <button className="btn-main py-2.5 text-base" disabled={busy} onClick={() => act("fold")}>
                폴드
              </button>
            )}
            {view.legal.includes("check") && (
              <button className="btn-main py-2.5 text-base" disabled={busy} onClick={() => act("check")}>
                체크
              </button>
            )}
            {view.legal.includes("call") && (
              <button className="btn-main py-2.5 text-base" disabled={busy} onClick={() => act("call")}>
                콜 {Math.min(toCall, seat.stack).toLocaleString("ko-KR")}
              </button>
            )}
            {bounds && (
              <button className="btn-main py-2.5 text-base" disabled={busy || !valid} onClick={() => act("raise", { amount: raiseTo })}>
                {game.currentBet === 0 ? "벳" : "레이즈"} {raiseTo.toLocaleString("ko-KR")}
              </button>
            )}
            {view.legal.includes("allin") && (
              <button className="btn-main py-2.5 text-base" disabled={busy} onClick={() => act("allin")}>
                올인 {(seat.streetContrib + seat.stack).toLocaleString("ko-KR")}
              </button>
            )}
          </div>
          {bounds && <p className="text-center text-[11px] text-muted">레이즈는 이번 라운드 총액 기준 {bounds.min.toLocaleString("ko-KR")}~{bounds.max.toLocaleString("ko-KR")}P</p>}
        </div>
      )}
    </div>
  );
}

/** 판 결과: 이긴 사람과 손익 (받은 금액에는 돌려받은 몫도 있어서 손익으로 보여 준다) */
export function HdResultLine({ view, game }: { view: RoomView; game: HoldemView }) {
  // 판이 끝나며 자리를 떠난 사람(칩 부족 등)은 좌석 목록에 없다
  const name = (id: string) => view.seats.find((s) => s.userId === id)?.username ?? "나간 사람";
  const winner = game.result!.winnerId;
  // startStack이 없는 예전 상태는 손익 0으로 (배포 시점에 진행 중이던 판)
  const nets = game.seats.map((s) => [s.id, s.stack - (s.startStack ?? s.stack)] as const).filter(([, n]) => n !== 0);
  const hand = game.result!.hands[winner];
  return (
    <p>
      <b className="text-accent">
        {name(winner)} 승리{hand ? ` · ${hand.category}` : ""}
      </b>
      <span className="ml-2 text-muted">
        {nets.map(([id, n]) => `${name(id)} ${n > 0 ? "+" : "−"}${Math.abs(n).toLocaleString("ko-KR")}P`).join(" · ")}
      </span>
    </p>
  );
}

/** 오른쪽 패널: 홀덤 족보 (낮은 것부터) + 지금 내 족보 강조 */
export function HdRanks({ category }: { category: string | null }) {
  return (
    <aside className="panel p-3" aria-label="홀덤 족보">
      <p className="mb-1 text-xs font-bold text-accent">족보 · 아래로 갈수록 강해요</p>
      <ol className="grid">
        {HOLDEM_CATEGORIES.map((c) => (
          <li
            key={c}
            aria-current={category === c ? "true" : undefined}
            className={`flex items-center justify-between rounded px-2 ${
              category === c ? "my-0.5 bg-accent py-0.5 text-sm font-bold text-[var(--accent-ink)] shadow" : "text-[11px] leading-[15px] text-muted"
            }`}
          >
            <span>{c}</span>
            {category === c && <span className="text-[10px]">내 패</span>}
          </li>
        ))}
      </ol>
      <ul className="mt-2 grid gap-0.5 text-[11px] text-muted">
        <li>내 카드 2장 + 공용 카드 5장 중 가장 좋은 5장</li>
        <li>같은 족보면 숫자 → 키커. 무늬는 안 봐요 (같으면 나눔)</li>
        <li>블라인드: SB = 기본금 절반, BB = 기본금</li>
        <li>노리밋: 최소 레이즈는 직전 레이즈 크기, 최대는 가진 것 전부</li>
      </ul>
    </aside>
  );
}
