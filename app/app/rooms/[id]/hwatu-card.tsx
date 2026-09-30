import { isSpecial, monthOf } from "@/lib/engine/sutda/hands";

const GWANG = new Set([1, 3, 8]);
const YEOL = new Set([4, 7, 9]);

/** 화투 한 장. card가 null이면 뒷면. */
export function HwatuCard({ card, small }: { card: number | null; small?: boolean }) {
  const size = small ? "h-14 w-10" : "h-24 w-16";
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
      aria-label={`${month}월${tag === "광" ? " 광" : tag === "열" ? " 열끗" : ""}`}
      className={`${size} flex flex-col items-center justify-between rounded-md border-2 border-[#5a1a16] bg-[var(--card)] py-1 font-display font-bold text-[var(--card-red)] shadow-md`}
    >
      <span className={small ? "text-lg leading-none" : "text-3xl leading-none"}>{month}</span>
      {tag ? (
        <span
          className={`rounded px-1 leading-4 ${small ? "text-[9px]" : "text-[11px]"} ${tag === "광" ? "bg-[var(--card-red)] text-white" : "bg-[#1c2030] text-white"}`}
        >
          {tag === "광" ? "광" : "열끗"}
        </span>
      ) : (
        <span className={small ? "h-3" : "h-4"} aria-hidden />
      )}
    </div>
  );
}
