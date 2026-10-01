"use client";

import { bestHand, CATEGORIES, openCardsHand } from "@/lib/engine/poker7/hands";
import { evaluate } from "@/lib/engine/sutda/hands";

/** 게임을 잘 몰라도 보이게: 족보를 낮은 것부터 작게 나열하고, 지금 내 패를 칠하고 키운다. */

export const SUTDA_ROWS = [
  "망통",
  "1끗",
  "2끗",
  "3끗",
  "4끗",
  "5끗",
  "6끗",
  "7끗",
  "8끗",
  "갑오",
  "세륙",
  "장사",
  "장삥",
  "구삥",
  "독사",
  "알리",
  "1땡",
  "2땡",
  "3땡",
  "4땡",
  "5땡",
  "6땡",
  "7땡",
  "8땡",
  "9땡",
  "장땡",
  "13·18광땡",
  "38광땡",
];

const SUTDA_SPECIALS: { name: string; desc: string }[] = [
  { name: "암행어사", desc: "4·7열끗, 13·18광땡 잡음" },
  { name: "땡잡이", desc: "3광·7열끗, 1~9땡 잡음" },
  { name: "구사", desc: "4·9, 알리 이하면 재경기" },
  { name: "멍텅구리구사", desc: "4·9열끗, 9땡 이하면 재경기" },
];

/** 섯다: 카드 2장의 족보 → 표의 행 이름 + 특수패 이름 */
export function sutdaPosition(cards: number[]): { row: string; special: string | null } | null {
  if (cards.length < 2) return null;
  const h = evaluate(cards[0], cards[1]);
  switch (h.kind) {
    case "38광땡":
      return { row: "38광땡", special: null };
    case "광땡":
      return { row: "13·18광땡", special: null };
    case "암행어사":
      return { row: "1끗", special: "암행어사" };
    case "땡잡이":
      return { row: "망통", special: "땡잡이" };
    case "구사":
    case "멍텅구리구사":
      return { row: "3끗", special: h.kind };
    default:
      return { row: h.label, special: null };
  }
}

/** 7포커: 지금 가진 카드로 만든 족보 (5장 미만이면 페어·트리플·포카드·탑만) */
export function pokerPosition(cards: number[]): string | null {
  if (cards.length === 0) return null;
  return cards.length >= 5 ? bestHand(cards).category : openCardsHand(cards.slice(0, 4)).category;
}

function Row({ name, active, hint }: { name: string; active: boolean; hint?: string }) {
  return (
    <li
      aria-current={active ? "true" : undefined}
      className={`flex items-center justify-between rounded px-2 transition-all ${
        active ? "my-0.5 bg-accent py-0.5 text-sm font-bold text-[var(--accent-ink)] shadow" : "text-[11px] leading-[15px] text-muted"
      }`}
    >
      <span>{name}</span>
      {active && <span className="text-[10px]">{hint ?? "내 패"}</span>}
    </li>
  );
}

export function HandRanks({ game, myCards }: { game: "sutda" | "poker7"; myCards: number[] }) {
  if (game === "sutda") {
    const pos = sutdaPosition(myCards);
    return (
      <aside className="panel p-3" aria-label="섯다 족보">
        <p className="mb-1 text-xs font-bold text-accent">족보 · 아래로 갈수록 강해요</p>
        <ol className="grid">
          {SUTDA_ROWS.map((r) => (
            <Row key={r} name={r} active={pos?.row === r} hint={pos?.special ? `${pos.special}` : undefined} />
          ))}
        </ol>
        <p className="mt-2 mb-1 text-xs font-bold text-accent">특수패</p>
        <ul className="grid gap-0.5">
          {SUTDA_SPECIALS.map((s) => (
            <li
              key={s.name}
              className={`rounded px-2 py-0.5 ${pos?.special === s.name ? "bg-accent text-sm font-bold text-[var(--accent-ink)]" : "text-[11px] text-muted"}`}
            >
              {s.name} <span className="opacity-80">· {s.desc}</span>
            </li>
          ))}
        </ul>
        {myCards.length < 2 && <p className="mt-2 text-[11px] text-muted">두 번째 카드를 받으면 내 족보가 표시돼요.</p>}
      </aside>
    );
  }
  const current = pokerPosition(myCards);
  return (
    <aside className="panel p-3" aria-label="7포커 족보">
      <p className="mb-1 text-xs font-bold text-accent">족보 · 아래로 갈수록 강해요</p>
      <ol className="grid">
        {CATEGORIES.map((c) => (
          <Row key={c} name={c} active={current === c} />
        ))}
      </ol>
      <p className="mt-2 text-[11px] text-muted">같은 족보면 숫자, 그다음 무늬(♠ ♦ ♥ ♣ 순)로 가려요.</p>
    </aside>
  );
}

/** 지금 내 패 이름 (모바일 접힌 족보 줄에 표시) */
export function myHandLabel(game: "sutda" | "poker7", myCards: number[]): string | null {
  if (game === "sutda") {
    const pos = sutdaPosition(myCards);
    return pos ? (pos.special ?? pos.row) : null;
  }
  return pokerPosition(myCards);
}
