import { rankOf, SUITS, suitOf } from "@/lib/engine/poker7/hands";

const FACE: Record<number, string> = { 11: "J", 12: "Q", 13: "K", 14: "A" };

/** 트럼프 한 장. card가 null이면 뒷면. selected면 강조 테두리. */
export function PlayingCard({ card, small, selected }: { card: number | null; small?: boolean; selected?: string }) {
  const size = small ? "h-14 w-10" : "h-24 w-16";
  if (card === null) {
    return (
      <div
        role="img"
        aria-label="뒷면 카드"
        className={`${size} rounded-md border-2 border-[#1c2a4a] bg-[repeating-linear-gradient(45deg,#26407a_0_6px,#1b2f5c_6px_12px)] shadow-md`}
      />
    );
  }
  const rank = rankOf(card);
  const suit = SUITS[suitOf(card)];
  const red = suitOf(card) === 1 || suitOf(card) === 2;
  const face = FACE[rank] ?? String(rank);
  return (
    <div
      role="img"
      aria-label={`${suit}${face}${selected ? ` (${selected})` : ""}`}
      className={`${size} relative flex flex-col items-center justify-center rounded-md border-2 bg-[var(--card)] font-display font-bold shadow-md ${
        red ? "text-[var(--card-red)]" : "text-[var(--card-ink)]"
      } ${selected ? "border-accent ring-2 ring-accent" : "border-[#c9c2ad]"}`}
    >
      <span className={small ? "text-base leading-none" : "text-2xl leading-none"}>{face}</span>
      <span className={small ? "text-sm leading-none" : "text-xl leading-none"}>{suit}</span>
      {selected && (
        <span className="absolute -top-2 rounded bg-accent px-1 text-[10px] leading-4 text-[var(--accent-ink)]">{selected}</span>
      )}
    </div>
  );
}
