"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { LegalAction } from "@/lib/rooms/games";
import type { RoomView } from "@/lib/rooms/service";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { BjDealer, BjMine, BjOthers, BjResultLine, BjRules, totalLabel } from "./blackjack-stage";
import { HwatuCard } from "./hwatu-card";
import { HandRanks, myHandLabel } from "./hand-ranks";
import { PlayingCard } from "./playing-card";

const ACTION_LABEL: Record<LegalAction, string> = {
  check: "체크",
  ping: "삥",
  call: "콜",
  ddadang: "따당",
  quarter: "쿼터",
  half: "하프",
  die: "다이",
  bet: "베팅",
  sit_out: "이번 판 쉬기",
  hit: "히트",
  stand: "스탠드",
  double: "더블",
  split: "스플릿",
};

const PHASE_LABEL: Record<string, string> = {
  idle: "시작 대기",
  seeding: "카드 섞는 중",
  playing: "진행 중",
  between: "다음 판 준비",
  closed: "닫힌 방",
};

type ApiResult<T> = { data?: T; error?: string };

async function post<T>(url: string, body: unknown = {}): Promise<ApiResult<T> & { status: number }> {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const json: ApiResult<T> = await res.json().catch(() => ({}));
  return { ...json, status: res.status };
}

function randomSeedHex(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function RoomTable({ roomId }: { roomId: string }) {
  const [view, setView] = useState<RoomView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [buyIn, setBuyIn] = useState<number | null>(null);
  /** 7포커 초이스: 먼저 누른 카드 = 버릴 카드, 다음 카드 = 공개할 카드 */
  const [pickState, setPickState] = useState<{ handId: string | null; discard: number | null; open: number | null }>({
    handId: null,
    discard: null,
    open: null,
  });
  /** 서버 시각 기준 현재 시간 (250ms마다 갱신) */
  const [now, setNow] = useState(() => Date.now());
  const offset = useRef(0);
  const seedSent = useRef<string | null>(null);
  const deadlineRef = useRef<number | null>(null);
  const lastTickAt = useRef(0);

  const refresh = useCallback(async () => {
    const res = await fetch(`/api/rooms/${roomId}`, { cache: "no-store" }).catch(() => null);
    if (!res) return;
    const body: ApiResult<RoomView> = await res.json().catch(() => ({}));
    if (!res.ok || !body.data) {
      setError(body.error ?? "방을 불러오지 못했어요.");
      return;
    }
    offset.current = new Date(body.data.serverNow).getTime() - Date.now();
    deadlineRef.current = body.data.deadline ? new Date(body.data.deadline).getTime() : null;
    setView(body.data);
  }, [roomId]);

  // 첫 조회 + 실시간 이벤트 구독 + 보조 폴링
  useEffect(() => {
    const first = setTimeout(() => void refresh(), 0);
    const supabase = supabaseBrowser();
    const channel = supabase
      .channel(`room:${roomId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "room_events", filter: `room_id=eq.${roomId}` }, () => {
        void refresh();
      })
      .subscribe();
    const poll = setInterval(() => void refresh(), 4000);
    // 250ms 시계: 화면 시간 갱신 + 기한이 지났으면 tick (서버가 한 번만 적용). 실패하거나 그대로면 2초마다 다시.
    const clock = setInterval(() => {
      const serverNow = Date.now() + offset.current;
      setNow(serverNow);
      const deadline = deadlineRef.current;
      if (deadline !== null && serverNow > deadline + 300 && Date.now() - lastTickAt.current > 2000) {
        lastTickAt.current = Date.now();
        void post(`/api/rooms/${roomId}/tick`)
          .catch(() => null)
          .then(() => refresh());
      }
    }, 250);
    return () => {
      clearTimeout(first);
      clearInterval(poll);
      clearInterval(clock);
      void supabase.removeChannel(channel);
    };
  }, [roomId, refresh]);

  // 섞기 전에 내 시드를 만들어 보관하고 제출 (검증 페이지에서 대조)
  useEffect(() => {
    if (!view?.needSeed || !view.handId || seedSent.current === view.handId) return;
    seedSent.current = view.handId;
    const handId = view.handId;
    const seed = randomSeedHex();
    void post(`/api/rooms/${roomId}/seed`, { clientSeed: seed }).then((r) => {
      // 서버가 받아들인 시드만 보관 (기한을 넘겨 거절되면 자동 시드가 쓰이므로 대조 대상이 아니다)
      if (!r.error) {
        try {
          localStorage.setItem(`bhmh.seed.${handId}`, seed);
        } catch {
          // 저장이 안 되면 검증 페이지의 "내 시드 대조"만 못 할 뿐 게임은 진행된다
        }
      }
      void refresh();
    });
  }, [view?.needSeed, view?.handId, roomId, refresh]);

  async function run(op: string, body: unknown = {}) {
    setBusy(true);
    setError(null);
    const r = await post(`/api/rooms/${roomId}/${op}`, body);
    setBusy(false);
    if (r.error) setError(r.error);
    await refresh();
  }

  if (!view) {
    return <main className="p-6 text-muted">{error ?? "불러오는 중…"}</main>;
  }

  const me = view.me;
  const mySeat = view.seats.find((s) => s.userId === me);
  // 섯다·포커는 game, 블랙잭은 bj (블랙잭 무대는 blackjack-stage.tsx)
  const game = view.game && view.game.game !== "blackjack" ? view.game : null;
  const isBJ = view.room.game === "blackjack";
  const bj = view.game?.game === "blackjack" ? view.game : null;
  const bjMine = bj?.seats.find((s) => s.id === me);
  // 내 점수: 스플릿했으면 손마다
  const bjTotal = bjMine?.hands.some((h) => h.cards.length > 0) ? bjMine.hands.map((h) => totalLabel(h.cards)).join(" / ") : null;
  const remaining = view.deadline ? Math.max(0, new Date(view.deadline).getTime() - now) : null;
  // 단계별 제한 시간 (lib/rooms/service.ts의 SEED_MS·TURN_MS·REJOIN_MS·CHOICE_MS·BET_MS·BETWEEN_MS와 같게)
  const totalMs =
    view.phase === "seeding" || view.phase === "between"
      ? 5000
      : view.game?.phase === "rejoin"
        ? 10000
        : view.game?.phase === "choice" || bj?.phase === "bet"
          ? 15000
          : 20000;
  const isHost = view.room.hostId === me;
  const poker = game?.game === "poker7" ? game : null;
  const sutda = game?.game === "sutda" ? game : null;
  const Card = view.room.game === "poker7" ? PlayingCard : HwatuCard;
  const pot = game
    ? game.seats.reduce((a, s) => a + s.handContrib, 0) + (sutda ? sutda.carried.reduce((a, p) => a + p.amount, 0) : 0)
    : bj && bj.phase !== "done"
      ? bj.seats.reduce((a, s) => a + s.committed, 0)
      : 0;
  const bossId = sutda ? sutda.bossId : poker && poker.phase !== "choice" ? poker.round.bossId : null;
  const choosing = poker?.phase === "choice" && poker.seats.some((s) => s.id === me) && !poker.chosen.includes(me);
  // 선택은 판마다 새로 (다른 판에서 누른 카드가 남지 않게)
  const pick = pickState.handId === view.handId ? pickState : { discard: null, open: null };
  const setPick = (next: (p: { discard: number | null; open: number | null }) => { discard: number | null; open: number | null }) =>
    setPickState({ handId: view.handId, ...next(pick) });
  const gameSeat = (id: string) => game?.seats.find((s) => s.id === id);
  const rejoin = sutda?.phase === "rejoin" ? sutda.rejoin : null;
  const minBuyIn = view.room.baseBet * 10;
  const result = view.phase === "between" && game?.result ? game.result : null;

  const myCards = game ? game.cards.filter((c) => c.ownerId === me && c.card !== null).map((c) => c.card!) : [];
  const myLabel = game ? myHandLabel(game.game, myCards) : null;
  const myGameSeat = gameSeat(me);
  const myTurn = view.legal.length > 0;
  const others = view.seats.filter((s) => s.userId !== me);
  const status =
    view.phase === "seeding"
      ? `모두의 시드를 모으는 중 (${view.seedsSubmitted.length}/${view.players.length})`
      : view.phase === "playing" && sutda?.phase === "rejoin"
        ? "구사 재경기 · 죽은 사람 참여 결정 중"
        : view.phase === "playing" && sutda
          ? `${sutda.rematchNo > 0 ? `재경기 ${sutda.rematchNo} · ` : ""}${sutda.phase === "bet1" ? "1차 베팅" : "2차 베팅"}`
          : view.phase === "playing" && poker?.phase === "choice"
            ? `초이스 · 버릴 카드와 공개할 카드를 고르는 중 (${poker.chosen.length}/${poker.seats.length})`
            : view.phase === "playing" && poker?.phase === "bet"
              ? `${poker.street}구${poker.street === 7 ? " (히든)" : ""} 베팅`
              : view.phase === "playing" && bj?.phase === "bet"
                ? `베팅 · 금액을 정하는 중 (${bj.seats.filter((s) => s.status !== "waiting").length}/${bj.seats.length})`
                : view.phase === "playing" && bj?.phase === "play"
                  ? `${view.seats.find((s) => s.userId === bj.toAct?.seatId)?.username ?? ""} 차례`
                  : view.phase === "between"
                    ? "판이 끝났어요"
                    : view.phase === "idle"
                      ? isBJ
                        ? "앉으면 방장이 시작할 수 있어요 (혼자서도 돼요)"
                        : "2명 이상 앉으면 방장이 시작할 수 있어요"
                      : PHASE_LABEL[view.phase];

  const seatBadges = (userId: string, turn: boolean) => {
    const gs = gameSeat(userId);
    const seat = view.seats.find((s) => s.userId === userId);
    const hand = result?.hands[userId];
    const handLabel = hand ? ("label" in hand ? hand.label : hand.category) : undefined;
    const won = result && (result.payouts[userId] ?? 0) > 0;
    return (
      <>
        {bossId === userId && <Badge>보스</Badge>}
        {poker?.phase === "choice" && poker.chosen.includes(userId) && <Badge>고름</Badge>}
        {view.room.hostId === userId && <Badge>방장</Badge>}
        {turn && <Badge tone="accent">차례</Badge>}
        {gs?.folded && view.players.includes(userId) && <Badge tone="bust">다이</Badge>}
        {gs?.allIn && !gs.folded && <Badge tone="accent">올인</Badge>}
        {seat?.status === "away" && <Badge>자리 비움</Badge>}
        {handLabel && <Badge tone={won ? "win" : undefined}>{handLabel}</Badge>}
      </>
    );
  };
  const isTurn = (id: string) =>
    bj ? bj.toAct?.seatId === id : game?.round.toActId === id && game.phase !== "done" && game.phase !== "rejoin" && game.phase !== "choice";

  return (
    // 데스크톱은 화면 높이에 딱 맞춘다 (스크롤 없이 한 화면). 모바일은 내용만큼 늘어나되 조작부는 아래에 붙는다.
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-3 px-3 py-3 lg:h-dvh">
      <header className="flex items-center justify-between gap-3 border-b border-accent/30 pb-2">
        <Link href="/rooms" className="shrink-0 rounded-full border border-gold-dim px-3 py-1 text-sm font-bold text-accent">
          ‹ 방 목록
        </Link>
        <div className="min-w-0 flex-1 text-center">
          <h1 className="truncate font-bold">{view.room.name}</h1>
          <p className="truncate text-xs text-muted">
            {view.room.game === "poker7" ? "7포커" : isBJ ? "블랙잭" : "섯다"} · 기본금 {view.room.baseBet.toLocaleString("ko-KR")}P ·{" "}
            {view.handNo > 0 ? `${view.handNo}번째 판` : "첫 판 전"}
          </p>
        </div>
        <span className="hidden w-24 shrink-0 text-right text-[11px] text-muted sm:block">
          {view.commit ? `커밋 ${view.commit.slice(0, 8)}…` : ""}
        </span>
      </header>

      <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[minmax(0,1fr)_210px]">
        <section className="stage flex min-h-0 flex-col gap-3 p-3 sm:p-4">
          {/* 상태 · 판돈 · 남은 시간 */}
          <div className="flex items-end justify-between gap-3">
            <p className="text-sm text-muted">{status}</p>
            <div className="text-right leading-none">
              <p className="text-[11px] text-muted">{isBJ ? "건 돈" : "판돈"}</p>
              <p className="font-display text-3xl text-accent">{pot.toLocaleString("ko-KR")}</p>
            </div>
          </div>
          <div
            className="h-1.5 overflow-hidden rounded bg-black/30"
            role="progressbar"
            aria-label="남은 시간"
            aria-valuemin={0}
            aria-valuemax={Math.round(totalMs / 1000)}
            aria-valuenow={remaining === null ? undefined : Math.ceil(remaining / 1000)}
            aria-hidden={remaining === null}
          >
            {remaining !== null && (
              <div className="h-full bg-accent transition-[width]" style={{ width: `${Math.min(100, (remaining / totalMs) * 100)}%` }} />
            )}
          </div>

          {/* 다른 사람 자리 (블랙잭은 위에 딜러) */}
          {isBJ ? (
            // 데스크톱: 딜러 | 다른 사람들 한 줄 (세로 공간 절약)
            <div className="flex min-h-0 flex-1 flex-col gap-2 lg:flex-row">
              {bj && (view.phase === "playing" || view.phase === "between") && <BjDealer game={bj} />}
              <BjOthers view={view} game={bj} badges={seatBadges} />
            </div>
          ) : (
          <ul className="grid min-h-0 flex-1 auto-rows-min content-start gap-2 overflow-auto sm:grid-cols-2 xl:grid-cols-3">
            {others.map((s) => {
              const gs = gameSeat(s.userId);
              const cards = game?.cards.filter((c) => c.ownerId === s.userId) ?? [];
              const turn = isTurn(s.userId);
              return (
                <li
                  key={s.userId}
                  className={`rounded-xl border p-2.5 ${turn ? "border-accent bg-accent/10" : "border-line bg-black/20"} ${gs?.folded ? "opacity-60" : ""}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate text-sm font-bold">{s.username}</p>
                    <span className="font-display">{s.stack.toLocaleString("ko-KR")}</span>
                  </div>
                  <div className="mt-1 flex min-h-5 flex-wrap gap-1 text-[11px]">{seatBadges(s.userId, turn)}</div>
                  {/* 카드가 많으면(7포커) 한 줄에 겹쳐 펼친다 */}
                  <div className="mt-1.5 flex min-h-[72px]">
                    {cards.map((c, i) => (
                      <div key={i} className={i === 0 ? "" : cards.length > 4 ? "-ml-6" : "ml-1"}>
                        <Card card={c.card} small />
                      </div>
                    ))}
                  </div>
                </li>
              );
            })}
            {others.length === 0 && <li className="text-sm text-muted">아직 다른 사람이 없어요. 방 주소를 친구에게 보내 주세요.</li>}
          </ul>
          )}

          {/* 판 결과 */}
          {view.phase === "between" && bj?.result && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-accent/40 bg-black/25 px-3 py-2 text-sm">
              <BjResultLine view={view} game={bj} />
              {view.handId && (
                <Link href={`/verify/${view.handId}`} className="text-accent underline">
                  이 판 검증하기
                </Link>
              )}
            </div>
          )}
          {result && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-accent/40 bg-black/25 px-3 py-2 text-sm">
              <p>
                <b className="text-accent">{view.seats.find((s) => s.userId === result.winnerId)?.username ?? "누군가"} 승리</b>
                {"splitAfterMaxRematches" in result && result.splitAfterMaxRematches && " · 재경기 3번 후 나눠 가짐"}
                <span className="ml-2 text-muted">
                  {Object.entries(result.payouts)
                    .map(([id, amt]) => `${view.seats.find((s) => s.userId === id)?.username ?? id.slice(0, 6)} +${amt.toLocaleString("ko-KR")}P`)
                    .join(" · ")}
                </span>
              </p>
              {view.handId && (
                <Link href={`/verify/${view.handId}`} className="text-accent underline">
                  이 판 검증하기
                </Link>
              )}
            </div>
          )}

          {/* 내 자리: 내 카드 크게 + 조작 */}
          {mySeat ? (
            <div
              className={`rounded-xl border p-3 ${myTurn ? "border-accent bg-accent/10" : "border-gold-dim/60 bg-black/25"} ${myGameSeat?.folded ? "opacity-80" : ""}`}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="font-bold">{mySeat.username}</span>
                  <span className="text-xs text-accent">(나)</span>
                  <div className="flex flex-wrap gap-1 text-[11px]">{seatBadges(me, isTurn(me))}</div>
                </div>
                <span className="font-display text-xl text-accent">{mySeat.stack.toLocaleString("ko-KR")}</span>
              </div>

              {bj ? (
                view.players.includes(me) && <BjMine key={view.handId} view={view} game={bj} busy={busy} run={run} />
              ) : choosing && poker ? (
                <div className="mt-2 grid justify-items-center gap-2">
                  <p className="text-sm">
                    {pick.discard === null ? "버릴 카드를 누르세요" : pick.open === null ? "공개할 카드를 누르세요" : "이대로 할까요?"}
                  </p>
                  <div className="flex flex-wrap justify-center gap-1.5 sm:gap-2">
                    {poker.cards
                      .filter((c) => c.ownerId === me && c.card !== null)
                      .map((c) => (
                        <button
                          key={c.card}
                          type="button"
                          disabled={busy}
                          aria-pressed={pick.discard === c.card || pick.open === c.card}
                          onClick={() =>
                            setPick((p) =>
                              p.discard === null
                                ? { discard: c.card, open: null }
                                : p.open === null && p.discard !== c.card
                                  ? { ...p, open: c.card }
                                  : { discard: c.card, open: null },
                            )
                          }
                        >
                          <PlayingCard card={c.card} selected={pick.discard === c.card ? "버림" : pick.open === c.card ? "공개" : undefined} />
                        </button>
                      ))}
                  </div>
                  <div className="flex gap-2">
                    <button className="btn-ghost px-4 py-2" disabled={busy} onClick={() => setPick(() => ({ discard: null, open: null }))}>
                      다시 고르기
                    </button>
                    <button
                      className="btn-main px-6 py-2"
                      disabled={busy || pick.discard === null || pick.open === null}
                      onClick={async () => {
                        await run("choose", { discard: pick.discard, open: pick.open });
                        setPick(() => ({ discard: null, open: null }));
                      }}
                    >
                      확정
                    </button>
                  </div>
                </div>
              ) : (
                game &&
                view.players.includes(me) && (
                  <div className="mt-2 flex min-h-24 justify-center sm:min-h-32 lg:gap-2">
                    {game.cards
                      .filter((c) => c.ownerId === me)
                      .map((c, i, all) => (
                        // 데스크톱(lg) 전에는 5장 이상이면 겹쳐서 한 줄에 (360px 폭: 66 + 6×30 = 246px)
                        <div key={i} className={i === 0 ? "" : all.length > 4 ? "-ml-9 lg:ml-0" : "ml-1.5 lg:ml-0"}>
                          <Card card={c.card} />
                        </div>
                      ))}
                  </div>
                )
              )}

              {rejoin && rejoin.candidates.includes(me) && !rejoin.decided.includes(me) && (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <p className="flex-1 text-sm">구사 재경기에 {rejoin.fee.toLocaleString("ko-KR")}P 내고 다시 들어갈까요?</p>
                  <button className="btn-main px-5 py-2" disabled={busy} onClick={() => run("rejoin", { join: true })}>
                    참여
                  </button>
                  <button className="btn-ghost px-5 py-2" disabled={busy} onClick={() => run("rejoin", { join: false })}>
                    안 함
                  </button>
                </div>
              )}

              {/* 베팅 버튼은 모두 같은 모양 (다이도 같은 색) */}
              {myTurn && !bj && (
                <div className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-7">
                  {view.legal.map((a) => (
                    <button
                      key={a}
                      className="btn-main py-2.5 text-base"
                      disabled={busy}
                      onClick={() => run("act", { action: a, expectedSeq: view.seq })}
                    >
                      {ACTION_LABEL[a]}
                    </button>
                  ))}
                </div>
              )}

              <div className="mt-2 flex flex-wrap items-center justify-end gap-2">
                {error && (
                  <p role="alert" className="mr-auto text-sm text-bust">
                    {error}
                  </p>
                )}
                {isHost && (view.phase === "idle" || view.phase === "between") && (
                  <button className="btn-main px-5 py-2" disabled={busy} onClick={() => run("start")}>
                    {view.phase === "between" ? "바로 다음 판" : "시작"}
                  </button>
                )}
                <button className="btn-ghost px-4 py-2 text-sm" disabled={busy || mySeat.status === "away"} onClick={() => run("stand")}>
                  {mySeat.status === "away" ? "이번 판 끝나면 일어서요" : "일어서기"}
                </button>
              </div>
            </div>
          ) : (
            view.room.status !== "closed" &&
            view.seats.length < view.room.maxSeats && (
              <div className="flex flex-wrap items-end gap-3 rounded-xl border border-gold-dim/60 bg-black/25 p-3">
                <label className="flex flex-col gap-1 text-sm">
                  가져갈 포인트 (최소 {minBuyIn.toLocaleString("ko-KR")}P)
                  <input
                    className="field w-40"
                    type="number"
                    min={minBuyIn}
                    value={buyIn ?? minBuyIn * 5}
                    onChange={(e) => setBuyIn(Number(e.target.value))}
                  />
                </label>
                <button className="btn-main px-6 py-2.5" disabled={busy} onClick={() => run("sit", { buyIn: buyIn ?? minBuyIn * 5 })}>
                  앉기
                </button>
              </div>
            )
          )}
          {/* 앉기 패널이 사라져도(방이 찼을 때 등) 오류는 보이게 */}
          {!mySeat && error && (
            <p role="alert" className="text-sm text-bust">
              {error}
            </p>
          )}
        </section>

        {/* 족보: 데스크톱은 옆에(안에서만 스크롤), 모바일은 접어 둔다 */}
        {game && mySeat && (
          <>
            <div className="hidden min-h-0 overflow-auto lg:block">
              <HandRanks game={game.game} myCards={myCards} />
            </div>
            <details className="panel p-3 lg:hidden">
              <summary className="cursor-pointer text-sm font-bold text-accent">
                족보 보기{myLabel ? ` · 내 패: ${myLabel}` : ""}
              </summary>
              <div className="mt-2">
                <HandRanks game={game.game} myCards={myCards} />
              </div>
            </details>
          </>
        )}
        {isBJ && mySeat && (
          <>
            <div className="hidden min-h-0 overflow-auto lg:block">
              <BjRules myTotal={bjTotal} />
            </div>
            <details className="panel p-3 lg:hidden">
              <summary className="cursor-pointer text-sm font-bold text-accent">
                규칙 보기{bjTotal ? ` · 내 점수: ${bjTotal}` : ""}
              </summary>
              <div className="mt-2">
                <BjRules myTotal={null} />
              </div>
            </details>
          </>
        )}
      </div>
    </main>
  );
}

function Badge({ children, tone }: { children: React.ReactNode; tone?: "accent" | "win" | "bust" }) {
  const cls =
    tone === "accent"
      ? "border-accent text-accent"
      : tone === "win"
        ? "border-win text-win"
        : tone === "bust"
          ? "border-bust/70 text-bust"
          : "border-line text-muted";
  return <span className={`rounded border px-1.5 py-0.5 ${cls}`}>{children}</span>;
}
