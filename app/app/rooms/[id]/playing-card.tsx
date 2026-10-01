import { rankOf, SUITS, suitOf } from "@/lib/engine/poker7/hands";

const FACE: Record<number, string> = { 11: "J", 12: "Q", 13: "K", 14: "A" };
const GOLD = "#d8a928";
const SKIN = "#f3d9b1";
const INK = "#1b1b1b";

/** 세로 위치(0~1) 기준 표준 핍 배치. 열: 0 왼쪽, 1 가운데, 2 오른쪽 */
const LAYOUT: Record<number, [number, number][]> = {
  2: [[1, 0], [1, 1]],
  3: [[1, 0], [1, 0.5], [1, 1]],
  4: [[0, 0], [2, 0], [0, 1], [2, 1]],
  5: [[0, 0], [2, 0], [1, 0.5], [0, 1], [2, 1]],
  6: [[0, 0], [2, 0], [0, 0.5], [2, 0.5], [0, 1], [2, 1]],
  7: [[0, 0], [2, 0], [1, 0.25], [0, 0.5], [2, 0.5], [0, 1], [2, 1]],
  8: [[0, 0], [2, 0], [1, 0.25], [0, 0.5], [2, 0.5], [1, 0.75], [0, 1], [2, 1]],
  9: [[0, 0], [2, 0], [0, 1 / 3], [2, 1 / 3], [1, 0.5], [0, 2 / 3], [2, 2 / 3], [0, 1], [2, 1]],
  10: [[0, 0], [2, 0], [1, 1 / 6], [0, 1 / 3], [2, 1 / 3], [0, 2 / 3], [2, 2 / 3], [1, 5 / 6], [0, 1], [2, 1]],
};

/** 0 ♠, 1 ♦, 2 ♥, 3 ♣ — 중심 (0,0), 대략 ±5 x ±6 */
function SuitPath({ suit }: { suit: number }) {
  switch (suit) {
    case 0:
      return <path d="M0 -6 C2.5 -3 5.5 -1.5 5.5 1.5 C5.5 3.8 3.3 4.5 1.7 3.4 C2 5 2.5 5.8 3.2 6.2 L-3.2 6.2 C-2.5 5.8 -2 5 -1.7 3.4 C-3.3 4.5 -5.5 3.8 -5.5 1.5 C-5.5 -1.5 -2.5 -3 0 -6 Z" fill="currentColor" />;
    case 1:
      return <path d="M0 -6.5 L4.8 0 L0 6.5 L-4.8 0 Z" fill="currentColor" />;
    case 2:
      return <path d="M0 6 C-7.5 0.2 -6 -5.5 -2.8 -5.5 C-1.3 -5.5 0 -4.4 0 -3 C0 -4.4 1.3 -5.5 2.8 -5.5 C6 -5.5 7.5 0.2 0 6 Z" fill="currentColor" />;
    default:
      return (
        <g fill="currentColor">
          <circle cx={0} cy={-2.8} r={2.8} />
          <circle cx={-3} cy={1.4} r={2.8} />
          <circle cx={3} cy={1.4} r={2.8} />
          <path d="M0 0 L-1.9 6.2 L1.9 6.2 Z" />
        </g>
      );
  }
}

function Pip({ suit, x, y, size, flip }: { suit: number; x: number; y: number; size: number; flip?: boolean }) {
  return (
    <g transform={`translate(${x} ${y}) rotate(${flip ? 180 : 0}) scale(${size / 12})`}>
      <SuitPath suit={suit} />
    </g>
  );
}

function Index({ face, suit, small }: { face: string; suit: number; small: boolean }) {
  const fs = small ? (face.length > 1 ? 10 : 12) : face.length > 1 ? 12 : 14;
  const x = small ? 7 : 8.5;
  return (
    <g>
      <text
        x={x}
        y={small ? 12 : 15}
        fontSize={fs}
        fontWeight={700}
        textAnchor="middle"
        fill="currentColor"
        fontFamily="inherit"
        letterSpacing={face.length > 1 ? -0.8 : 0}
      >
        {face}
      </text>
      <Pip suit={suit} x={x} y={small ? 19.5 : 24.5} size={small ? 7 : 9} />
    </g>
  );
}

/** 얼굴 카드의 상반신 (정상 크기 좌표, 중심선 y=46, 프레임 x 17~43) */
function Bust({ face, suit }: { face: string; suit: number }) {
  return (
    <g strokeLinejoin="round" strokeLinecap="round">
      <path d="M19 46 C19 39 24.5 36 30 36 C35.5 36 41 39 41 46 Z" fill="currentColor" />
      <path d="M26 37 L30 42 L34 37" fill="none" stroke={GOLD} strokeWidth={1.2} />
      {face === "Q" && <path d="M23.5 23 C21 28 22 34 25 36 L26 28 Z M36.5 23 C39 28 38 34 35 36 L34 28 Z" fill="currentColor" />}
      <circle cx={30} cy={29} r={5.6} fill={SKIN} stroke={INK} strokeWidth={0.7} />
      <circle cx={28} cy={28.6} r={0.6} fill={INK} />
      <circle cx={32} cy={28.6} r={0.6} fill={INK} />
      {face === "K" && (
        <>
          <path d="M26.5 32 C28 34.5 32 34.5 33.5 32 C32 33 28 33 26.5 32 Z" fill={INK} />
          <path d="M24 24 L23.5 16 L27 20 L30 14 L33 20 L36.5 16 L36 24 Z" fill={GOLD} stroke={INK} strokeWidth={0.7} />
        </>
      )}
      {face === "Q" && (
        <>
          <path d="M26.5 31.5 C28 32.5 32 32.5 33.5 31.5" stroke={INK} strokeWidth={0.6} fill="none" />
          <path d="M24.5 24 L25.5 17.5 L28 21 L30 15.5 L32 21 L34.5 17.5 L35.5 24 Z" fill={GOLD} stroke={INK} strokeWidth={0.7} />
        </>
      )}
      {face === "J" && (
        <>
          <path d="M26.5 31.5 C28 32.5 32 32.5 33.5 31.5" stroke={INK} strokeWidth={0.6} fill="none" />
          <path d="M24.2 26 C24.2 17.5 35.8 17.5 35.8 26 Z" fill="currentColor" stroke={INK} strokeWidth={0.6} />
          <path d="M33 20 C37 16 40 16 41 12" stroke={GOLD} strokeWidth={1.3} fill="none" />
        </>
      )}
      <Pip suit={suit} x={22.5} y={16} size={6} />
    </g>
  );
}

/** 트럼프 한 장. card가 null이면 뒷면. selected면 강조 테두리. */
export function PlayingCard({ card, small, selected }: { card: number | null; small?: boolean; selected?: string }) {
  // 큰 카드는 휴대폰에서 조금 작게 (4장이 한 줄에 들어가게)
  const size = small ? "h-[72px] w-[50px]" : "h-24 w-[66px] sm:h-32 sm:w-[88px]";
  if (card === null) {
    return (
      <div
        role="img"
        aria-label="뒷면 카드"
        className={`${size} rounded-md border-2 border-[#1c2a4a] bg-[repeating-linear-gradient(45deg,#26407a_0_6px,#1b2f5c_6px_12px)] shadow-md`}
      />
    );
  }
  // 블랙잭은 6덱(0~311)이라 52로 나눈 나머지가 실제 카드
  const rank = rankOf(card % 52);
  const suitIdx = suitOf(card % 52);
  const suit = SUITS[suitIdx];
  const red = suitIdx === 1 || suitIdx === 2;
  const face = FACE[rank] ?? String(rank);
  const isFace = rank >= 11 && rank <= 13;
  // SVG 좌표 단위 (카드 비율에 맞춘 값, 실제 크기로는 늘려서 그린다)
  const w = small ? 36 : 60;
  const h = small ? 52 : 92;
  const pips = LAYOUT[rank];
  const colX = [w * 0.34, w * 0.5, w * 0.66];
  const top = 17;
  const span = h - 34;
  return (
    <div
      role="img"
      aria-label={`${suit}${face}${selected ? ` (${selected})` : ""}`}
      className={`${size} relative rounded-md border-2 bg-[var(--card)] font-display font-bold shadow-md ${
        red ? "text-[var(--card-red)]" : "text-[var(--card-ink)]"
      } ${selected ? "border-accent ring-2 ring-accent" : "border-[#c9c2ad]"}`}
    >
      <svg viewBox={`0 0 ${w} ${h}`} className="absolute inset-0 h-full w-full" aria-hidden focusable="false">
        <Index face={face} suit={suitIdx} small={!!small} />
        {small ? (
          isFace ? (
            <g transform="translate(19 31) scale(0.78) translate(-30 -30)">
              <Bust face={face} suit={suitIdx} />
            </g>
          ) : (
            <Pip suit={suitIdx} x={w * 0.56} y={h * 0.6} size={rank === 14 ? 22 : 18} />
          )
        ) : (
          <g>
            {rank === 14 && <Pip suit={suitIdx} x={w / 2} y={h / 2} size={34} />}
            {pips?.map(([c, r], i) => (
              <Pip key={i} suit={suitIdx} x={colX[c]} y={top + r * span} size={11.5} flip={r > 0.5} />
            ))}
            {isFace && (
              <g>
                <rect x={17} y={12} width={26} height={68} rx={2} fill="currentColor" fillOpacity={0.07} stroke="currentColor" strokeWidth={0.9} />
                <Bust face={face} suit={suitIdx} />
                <g transform="rotate(180 30 46)">
                  <Bust face={face} suit={suitIdx} />
                </g>
              </g>
            )}
          </g>
        )}
        <g transform={`rotate(180 ${w / 2} ${h / 2})`}>{!small && <Index face={face} suit={suitIdx} small={false} />}</g>
      </svg>
      {selected && (
        <span className="absolute -top-2 left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-accent px-1 text-[10px] leading-4 text-[var(--accent-ink)]">
          {selected}
        </span>
      )}
    </div>
  );
}
