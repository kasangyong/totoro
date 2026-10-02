import { isSpecial, monthOf } from "@/lib/engine/sutda/hands";
import { HwatuArt } from "./hwatu-art";

const GWANG = new Set([1, 3, 8]);
const YEOL = new Set([4, 7, 9]);

/** 화투 한 장. card가 null이면 뒷면. selected면 강조 테두리와 이름표(예: "공개", "사용"), dim이면 흐리게(버린 카드). */
export function HwatuCard({ card, small, selected, dim }: { card: number | null; small?: boolean; selected?: string; dim?: boolean }) {
  // 큰 카드는 휴대폰에서 조금 작게 (4장이 한 줄에 들어가게)
  const size = small ? "h-[72px] w-[50px]" : "h-24 w-[66px] sm:h-32 sm:w-[88px]";
  if (card === null) {
    return (
      <div
        role="img"
        aria-label="뒷면 카드"
        className={`${size} rounded-md border-2 border-[#5a1a16] bg-[repeating-linear-gradient(45deg,#8e241e_0_6px,#6f1a15_6px_12px)] shadow-md`}
      />
    );
  }
  const month = monthOf(card);
  const special = isSpecial(card);
  const tag = special && GWANG.has(month) ? "광" : special && YEOL.has(month) ? "열" : null;
  return (
    <div
      role="img"
      aria-label={`${month}월${tag === "광" ? " 광" : tag === "열" ? " 열끗" : ""}${selected ? ` (${selected})` : ""}${dim ? " (안 씀)" : ""}`}
      className={`${size} relative overflow-hidden rounded-md border-2 bg-[var(--card)] font-display font-bold text-[var(--card-red)] shadow-md ${
        selected ? "border-accent ring-2 ring-accent" : "border-[#5a1a16]"
      } ${dim ? "opacity-45 grayscale" : ""}`}
    >
      <svg viewBox="0 0 60 96" preserveAspectRatio="xMidYMid slice" className="absolute inset-0 h-full w-full" aria-hidden focusable="false">
        <HwatuArt month={month} special={special} />
      </svg>
      <span
        aria-hidden
        className={`absolute left-0.5 top-0.5 flex items-center justify-center rounded-full border border-[#5a1a16]/40 bg-[var(--card)] leading-none ${
          small ? "h-3.5 w-3.5 text-[9px]" : "h-5 w-5 text-xs"
        }`}
      >
        {month}
      </span>
      {tag && (
        <span
          aria-hidden
          className={`absolute bottom-0.5 left-1/2 -translate-x-1/2 whitespace-nowrap rounded px-1 leading-4 ${small ? "text-[9px]" : "text-[11px]"} ${
            tag === "광" ? "bg-[var(--card-red)] text-white" : "bg-[#1c2030] text-white"
          }`}
        >
          {tag === "광" ? "광" : "열끗"}
        </span>
      )}
      {selected && (
        <span aria-hidden className="absolute right-0.5 top-0.5 whitespace-nowrap rounded bg-accent px-1 text-[10px] leading-4 text-[var(--accent-ink)]">
          {selected}
        </span>
      )}
    </div>
  );
}
