/* 화투 10개월 모티프 (viewBox 0 0 60 96). 모서리 월 숫자 / 하단 배지 영역을 피해 y 14~82 위주로 그린다. */

const INK = "#1b1b1b";
const RED = "#c8281e";
const GREEN = "#3a8a47";
const DGREEN = "#1f5b31";
const GOLD = "#d8a928";
const BROWN = "#6b4423";
const PINK = "#f2a3b6";
const BLUE = "#2a4f9e";
const WHITE = "#fbf7ea";

const SW = 0.8;

function Flower({ cx, cy, r, fill, edge, center = GOLD }: { cx: number; cy: number; r: number; fill: string; edge: string; center?: string }) {
  const petals = [0, 72, 144, 216, 288].map((a) => {
    const rad = (a * Math.PI) / 180;
    return { x: cx + Math.sin(rad) * r * 0.62, y: cy - Math.cos(rad) * r * 0.62 };
  });
  return (
    <g>
      {petals.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r={r * 0.52} fill={fill} stroke={edge} strokeWidth={0.6} />
      ))}
      <circle cx={cx} cy={cy} r={r * 0.28} fill={center} />
    </g>
  );
}

function Ribbon({ color, x = 43, y = 20 }: { color: string; x?: number; y?: number }) {
  return (
    <g transform={`rotate(7 ${x + 5} ${y + 19})`}>
      <path d={`M${x} ${y} h10 v38 l-5 -4 l-5 4 Z`} fill={color} stroke={INK} strokeWidth={SW} />
      <path d={`M${x + 3} ${y + 5} v22 M${x + 7} ${y + 5} v22`} stroke={WHITE} strokeWidth={0.9} strokeLinecap="round" opacity={0.85} />
    </g>
  );
}

function Leaf({ x, y, s, rot, fill }: { x: number; y: number; s: number; rot: number; fill: string }) {
  return (
    <path
      d="M0 -6 L1.8 -2.5 L5 -4 L3.8 -0.5 L6.5 0.5 L2.8 2.5 L3.3 5 L0 3.5 L-3.3 5 L-2.8 2.5 L-6.5 0.5 L-3.8 -0.5 L-5 -4 L-1.8 -2.5 Z"
      transform={`translate(${x} ${y}) rotate(${rot}) scale(${s})`}
      fill={fill}
      stroke={INK}
      strokeWidth={SW / s}
      strokeLinejoin="round"
    />
  );
}

function Clump({ cx, cy, rx }: { cx: number; cy: number; rx: number }) {
  const ry = rx * 0.4;
  return (
    <g>
      <ellipse cx={cx} cy={cy} rx={rx} ry={ry} fill={GREEN} stroke={DGREEN} strokeWidth={SW} />
      <path
        d={`M${cx - rx * 0.65} ${cy + ry * 0.1} Q${cx} ${cy - ry * 1.3} ${cx + rx * 0.65} ${cy + ry * 0.1} M${cx - rx * 0.35} ${cy + ry * 0.55} Q${cx} ${cy - ry * 0.2} ${cx + rx * 0.35} ${cy + ry * 0.55}`}
        stroke={DGREEN}
        strokeWidth={0.7}
        fill="none"
        strokeLinecap="round"
      />
    </g>
  );
}

/* 1월 송학 */
function Pine({ special }: { special: boolean }) {
  return (
    <g>
      {special ? <circle cx={44} cy={21} r={9} fill={RED} /> : <Ribbon color={RED} />}
      <path d="M18 84 C13 70 24 62 20 48 C17 40 22 34 22 26" stroke={BROWN} strokeWidth={4.5} strokeLinecap="round" fill="none" />
      <path d="M21 50 C28 48 34 46 40 40 M19 62 C14 60 10 56 9 48" stroke={BROWN} strokeWidth={2.4} strokeLinecap="round" fill="none" />
      <Clump cx={22} cy={25} rx={14} />
      <Clump cx={40} cy={38} rx={11} />
      <Clump cx={11} cy={46} rx={9} />
      {special && (
        <g strokeLinejoin="round" strokeLinecap="round">
          <path d="M31 62 L23 66 L31 66 Z" fill={INK} />
          <path d="M44 55 C50 50 49 46 47 44" stroke={INK} strokeWidth={SW} fill="none" />
          <ellipse cx={39} cy={62} rx={10} ry={6} fill={WHITE} stroke={INK} strokeWidth={SW} />
          <path d="M44 56 C48 52 48 47 47 44" stroke={INK} strokeWidth={3} fill="none" />
          <path d="M44 56 C48 52 48 47 47 44" stroke={WHITE} strokeWidth={1.8} fill="none" />
          <circle cx={47} cy={43} r={2.6} fill={WHITE} stroke={INK} strokeWidth={SW} />
          <circle cx={47} cy={41.2} r={1.2} fill={RED} />
          <path d="M49.4 43.4 L54 44.6 L49.4 45" fill={GOLD} stroke={INK} strokeWidth={0.5} />
          <path d="M36 67 V76 M41 67 V76" stroke={INK} strokeWidth={0.9} />
          <path d="M33 61 C37 58 43 58 46 62" stroke={INK} strokeWidth={0.7} fill="none" />
        </g>
      )}
    </g>
  );
}

/* 2월 매조 */
function Plum({ special }: { special: boolean }) {
  const flowers: [number, number, number][] = [
    [28, 24, 3.4],
    [46, 60, 3.2],
    [37, 44, 3.2],
    [53, 22, 3.4],
    [20, 71, 3.2],
    [44, 32, 3],
    [14, 78, 2.8],
  ];
  return (
    <g>
      {!special && <Ribbon color={RED} />}
      <path d="M4 86 C16 74 26 62 34 48 C40 38 46 30 54 22" stroke={BROWN} strokeWidth={3.4} strokeLinecap="round" fill="none" />
      <path d="M28 58 C34 61 40 59 46 60 M40 40 C34 34 30 30 28 24 M20 70 C24 66 28 64 30 60" stroke={BROWN} strokeWidth={2} strokeLinecap="round" fill="none" />
      {flowers.map(([x, y, r], i) => (
        <Flower key={i} cx={x} cy={y} r={r * 1.5} fill={special ? PINK : "#f6b6c4"} edge="#c35a78" />
      ))}
      {special && (
        <g strokeLinejoin="round" strokeLinecap="round">
          <path d="M26 57 L17 62 L27 61 Z" fill="#5c6a2a" stroke={INK} strokeWidth={0.5} />
          <ellipse cx={31} cy={53} rx={7} ry={4.5} transform="rotate(-25 31 53)" fill="#8a9a3c" stroke={INK} strokeWidth={SW} />
          <ellipse cx={32} cy={55} rx={4.5} ry={2.4} transform="rotate(-25 32 55)" fill="#ece3a4" />
          <circle cx={37} cy={47.5} r={3.2} fill="#8a9a3c" stroke={INK} strokeWidth={SW} />
          <circle cx={38} cy={46.8} r={0.7} fill={INK} />
          <path d="M39.8 47.4 L43 48.2 L40 49" fill={GOLD} stroke={INK} strokeWidth={0.4} />
        </g>
      )}
    </g>
  );
}

/* 3월 벚꽃 */
function Cherry({ special }: { special: boolean }) {
  const flowers: [number, number, number][] = [
    [22, 29, 4],
    [35, 36, 3.6],
    [14, 41, 3.6],
    [28, 49, 3.8],
    [41, 59, 3.8],
    [20, 61, 3.4],
    [48, 74, 3.4],
  ];
  return (
    <g>
      {special ? (
        <g>
          <path d="M2 20 H58 V38 Q51 43 44 38 Q37 43 30 38 Q23 43 16 38 Q9 43 2 38 Z" fill={RED} stroke={INK} strokeWidth={SW} />
          <path d="M9 20 V40 M23 20 V40 M37 20 V40 M51 20 V40" stroke={WHITE} strokeWidth={4.5} />
          <path d="M2 20 H58" stroke={INK} strokeWidth={1.6} />
        </g>
      ) : (
        <Ribbon color={RED} />
      )}
      <path d="M52 90 C46 72 32 64 25 50 C20 42 19 36 22 29 M32 62 C38 60 42 60 42 59 M22 50 C18 46 15 44 14 41" stroke={BROWN} strokeWidth={2.6} strokeLinecap="round" fill="none" />
      {flowers.map(([x, y, r], i) => (
        <Flower key={i} cx={x} cy={y} r={r * 1.5} fill="#fde0e8" edge="#e07a99" center="#e8a0b4" />
      ))}
    </g>
  );
}

/* 4월 흑싸리 */
function Wisteria({ special }: { special: boolean }) {
  const clusters: [number, number][] = [
    [14, 5],
    [25, 7],
    [36, 6],
    [47, 5],
  ];
  return (
    <g>
      <path d="M4 17 C20 11 40 11 57 18" stroke={BROWN} strokeWidth={2.6} strokeLinecap="round" fill="none" />
      {[
        [10, 16, -30],
        [30, 12, 20],
        [52, 17, 40],
      ].map(([x, y, r], i) => (
        <ellipse key={i} cx={x} cy={y} rx={5} ry={2.2} transform={`rotate(${r} ${x} ${y})`} fill={GREEN} stroke={DGREEN} strokeWidth={0.6} />
      ))}
      {clusters.map(([x, n], ci) => (
        <g key={ci}>
          {Array.from({ length: n + 1 }, (_, i) => (
            <ellipse
              key={i}
              cx={x + (i % 2 ? 1 : -1) * 0.7}
              cy={19 + i * 5.2}
              rx={4.6 - i * 0.5}
              ry={3.2}
              fill={i % 2 ? "#2c2140" : "#3d2c5c"}
              stroke={INK}
              strokeWidth={0.5}
            />
          ))}
        </g>
      ))}
      {special && (
        <g strokeLinejoin="round" strokeLinecap="round">
          <path d="M24 74 L12 80 L26 79 Z" fill="#555b66" stroke={INK} strokeWidth={0.6} />
          <ellipse cx={30} cy={72} rx={9} ry={5.5} transform="rotate(-12 30 72)" fill="#8b919c" stroke={INK} strokeWidth={SW} />
          <path d="M24 70 C30 64 38 68 36 74 C30 75 26 74 24 70 Z" fill="#454b58" />
          <circle cx={39} cy={67} r={3.4} fill="#8b919c" stroke={INK} strokeWidth={SW} />
          <circle cx={40} cy={66.4} r={0.7} fill={INK} />
          <path d="M41.8 66.8 L46 68 L42 69" fill={GOLD} stroke={INK} strokeWidth={0.4} />
        </g>
      )}
    </g>
  );
}

/* 5월 난초 */
function Iris({ special }: { special: boolean }) {
  const blooms: [number, number][] = [
    [30, 27],
    [41, 40],
    [20, 43],
  ];
  return (
    <g>
      {[
        "M20 84 C20 62 22 46 20 36 C27 50 29 68 27 84 Z",
        "M29 84 C28 60 31 44 30 30 C36 46 36 66 34 84 Z",
        "M38 84 C37 66 40 54 41 44 C46 56 44 70 43 84 Z",
      ].map((d, i) => (
        <path key={i} d={d} fill={GREEN} stroke={DGREEN} strokeWidth={0.7} />
      ))}
      {blooms.map(([x, y], i) => (
        <g key={i}>
          {[0, 120, 240].map((a) => (
            <ellipse key={a} cx={x} cy={y - 5} rx={3.6} ry={6} transform={`rotate(${a} ${x} ${y})`} fill="#5a4bb0" stroke="#2a2260" strokeWidth={0.6} />
          ))}
          <circle cx={x} cy={y} r={2} fill={GOLD} />
        </g>
      ))}
      {special && (
        <g>
          <path d="M3 78 L20 68 L35 75 L57 64 L57 70 L35 81 L20 74 L3 84 Z" fill={BROWN} stroke={INK} strokeWidth={SW} strokeLinejoin="round" />
          <path d="M12 73 L12 80 M27 71 L27 78 M44 70 L44 77" stroke={INK} strokeWidth={0.8} />
          <path d="M4 79 L20 69 L35 76 L57 65" stroke="#a9794a" strokeWidth={1} fill="none" />
        </g>
      )}
    </g>
  );
}

function Butterfly({ x, y, s, rot }: { x: number; y: number; s: number; rot: number }) {
  return (
    <g transform={`translate(${x} ${y}) rotate(${rot}) scale(${s})`} strokeLinejoin="round">
      <ellipse cx={-4} cy={-2} rx={4.6} ry={3.2} transform="rotate(-25 -4 -2)" fill="#f0a52a" stroke={INK} strokeWidth={0.6} />
      <ellipse cx={4} cy={-2} rx={4.6} ry={3.2} transform="rotate(25 4 -2)" fill="#f0a52a" stroke={INK} strokeWidth={0.6} />
      <ellipse cx={-3} cy={3} rx={3} ry={2.2} transform="rotate(20 -3 3)" fill="#d8501e" stroke={INK} strokeWidth={0.6} />
      <ellipse cx={3} cy={3} rx={3} ry={2.2} transform="rotate(-20 3 3)" fill="#d8501e" stroke={INK} strokeWidth={0.6} />
      <path d="M0 -4 V5 M0 -4 L-2 -7 M0 -4 L2 -7" stroke={INK} strokeWidth={0.8} strokeLinecap="round" />
    </g>
  );
}

function Peony({ cx, cy, r }: { cx: number; cy: number; r: number }) {
  return (
    <g>
      {[0, 60, 120, 180, 240, 300].map((a) => {
        const rad = (a * Math.PI) / 180;
        return <circle key={a} cx={cx + Math.sin(rad) * r * 0.55} cy={cy - Math.cos(rad) * r * 0.55} r={r * 0.48} fill="#c42b48" stroke={INK} strokeWidth={0.6} />;
      })}
      <circle cx={cx} cy={cy} r={r * 0.62} fill="#e0586f" stroke="#8a1a30" strokeWidth={0.6} />
      <circle cx={cx} cy={cy} r={r * 0.34} fill="#f5a9b4" stroke="#8a1a30" strokeWidth={0.5} />
      <circle cx={cx} cy={cy} r={r * 0.12} fill={GOLD} />
    </g>
  );
}

/* 6월 모란 */
function PeonyArt({ special }: { special: boolean }) {
  return (
    <g>
      {!special && <Ribbon color={BLUE} />}
      {[
        [14, 70, -40],
        [46, 74, 35],
        [30, 64, 0],
        [12, 40, -60],
        [48, 44, 60],
      ].map(([x, y, r], i) => (
        <ellipse key={i} cx={x} cy={y} rx={6.5} ry={11} transform={`rotate(${r} ${x} ${y})`} fill={GREEN} stroke={DGREEN} strokeWidth={0.7} />
      ))}
      <path d="M30 80 V56 M18 72 L26 56 M44 74 L36 56" stroke={DGREEN} strokeWidth={1.4} strokeLinecap="round" />
      <Peony cx={30} cy={38} r={14} />
      <Peony cx={17} cy={58} r={9} />
      <Peony cx={44} cy={56} r={10} />
      {special && (
        <g>
          <Butterfly x={50} y={22} s={1.1} rot={20} />
          <Butterfly x={13} y={76} s={1} rot={-25} />
        </g>
      )}
    </g>
  );
}

/* 7월 홍싸리 */
function BushClover({ special }: { special: boolean }) {
  const stems = ["M10 84 C14 62 24 42 18 24", "M26 84 C32 64 44 52 50 32", "M40 84 C44 72 50 64 57 62"];
  const dots: [number, number][] = [
    [18, 26],
    [16, 33],
    [21, 36],
    [18, 43],
    [24, 47],
    [50, 34],
    [46, 40],
    [52, 43],
    [44, 48],
    [48, 53],
    [56, 63],
    [52, 66],
    [14, 52],
    [12, 60],
    [34, 60],
    [38, 56],
  ];
  return (
    <g>
      {!special && <Ribbon color={RED} x={4} y={22} />}
      {stems.map((d, i) => (
        <path key={i} d={d} stroke={DGREEN} strokeWidth={1.8} strokeLinecap="round" fill="none" />
      ))}
      {[
        [14, 70, -30],
        [22, 56, 40],
        [34, 70, 30],
        [44, 62, -40],
        [30, 48, -20],
      ].map(([x, y, r], i) => (
        <ellipse key={i} cx={x} cy={y} rx={2.6} ry={5} transform={`rotate(${r} ${x} ${y})`} fill={GREEN} stroke={DGREEN} strokeWidth={0.5} />
      ))}
      {dots.map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r={2.2} fill={i % 3 ? "#d6406b" : "#b72a52"} stroke="#6a1230" strokeWidth={0.4} />
      ))}
      {special && (
        <g strokeLinejoin="round" strokeLinecap="round">
          <path d="M14 70 C9 66 7 70 10 72" stroke={INK} strokeWidth={1} fill="none" />
          <path d="M18 76 V82 M24 76 V82 M33 76 V82 M39 76 V82" stroke={INK} strokeWidth={2.2} />
          <ellipse cx={28} cy={69} rx={14} ry={7.5} fill="#7b5535" stroke={INK} strokeWidth={SW} />
          <path d="M16 66 C20 60 24 60 26 62 M22 63 L24 59 M28 62 L30 58 M34 62 L36 59" stroke={INK} strokeWidth={0.8} fill="none" />
          <ellipse cx={42} cy={69} rx={6.5} ry={5.5} fill="#8d6340" stroke={INK} strokeWidth={SW} />
          <ellipse cx={47.5} cy={71} rx={3.2} ry={2.6} fill="#c79a74" stroke={INK} strokeWidth={0.6} />
          <path d="M41 63.5 L42 59 L45 64 Z" fill="#7b5535" stroke={INK} strokeWidth={0.6} />
          <path d="M44 73 C46 76 48 75 48 73" stroke={WHITE} strokeWidth={1.6} fill="none" />
          <circle cx={43.5} cy={67} r={0.9} fill={INK} />
        </g>
      )}
    </g>
  );
}

/* 8월 공산 */
function Pampas({ special }: { special: boolean }) {
  return (
    <g>
      {special && (
        <g>
          <rect x={3} y={3} width={54} height={90} rx={3} fill={RED} />
          <circle cx={30} cy={36} r={17} fill="#fff4cf" stroke={GOLD} strokeWidth={1.4} />
          <circle cx={30} cy={36} r={13} fill="none" stroke="#f0dc9a" strokeWidth={0.6} />
        </g>
      )}
      <path d="M3 68 C14 54 42 52 57 66 L57 93 L3 93 Z" fill="#26262c" />
      <path d="M8 68 C18 60 36 58 50 66" stroke="#4a4a52" strokeWidth={0.8} fill="none" />
      {[
        [14, 74, 10, 50],
        [24, 76, 26, 44],
        [36, 76, 34, 48],
        [46, 74, 50, 52],
      ].map(([x, y, tx, ty], i) => (
        <g key={i}>
          <path d={`M${x} ${y} Q${x} ${(y + ty) / 2} ${tx} ${ty}`} stroke="#d8c68a" strokeWidth={1} fill="none" strokeLinecap="round" />
          <ellipse
            cx={tx}
            cy={ty - 5}
            rx={2.8}
            ry={8}
            transform={`rotate(${(tx - x) * 2.2} ${tx} ${ty})`}
            fill={special ? WHITE : "#efe3b0"}
            stroke="#b79a45"
            strokeWidth={0.6}
          />
        </g>
      ))}
    </g>
  );
}

function Mum({ cx, cy, r, fill, tip }: { cx: number; cy: number; r: number; fill: string; tip: string }) {
  return (
    <g>
      {Array.from({ length: 14 }, (_, i) => (
        <ellipse
          key={i}
          cx={cx}
          cy={cy - r * 0.62}
          rx={r * 0.17}
          ry={r * 0.42}
          transform={`rotate(${i * (360 / 14)} ${cx} ${cy})`}
          fill={fill}
          stroke={tip}
          strokeWidth={0.5}
        />
      ))}
      <circle cx={cx} cy={cy} r={r * 0.28} fill="#e0711c" stroke={tip} strokeWidth={0.5} />
    </g>
  );
}

/* 9월 국진 */
function Chrysanthemum({ special }: { special: boolean }) {
  return (
    <g>
      {!special && <Ribbon color={BLUE} x={44} y={42} />}
      {[
        [14, 52, -50],
        [46, 52, 50],
        [30, 56, 0],
        [18, 28, -30],
      ].map(([x, y, r], i) => (
        <ellipse key={i} cx={x} cy={y} rx={5.5} ry={9} transform={`rotate(${r} ${x} ${y})`} fill={GREEN} stroke={DGREEN} strokeWidth={0.7} />
      ))}
      <Mum cx={30} cy={32} r={14} fill="#f1c232" tip="#a77b0a" />
      <Mum cx={15} cy={50} r={9} fill="#f8e08a" tip="#a77b0a" />
      {!special && <Mum cx={34} cy={63} r={10} fill="#f1c232" tip="#a77b0a" />}
      {special ? (
        <g strokeLinejoin="round">
          <path d="M22 62 H46 C46 74 40 80 34 80 C28 80 22 74 22 62 Z" fill={RED} stroke={INK} strokeWidth={SW} />
          <ellipse cx={34} cy={62} rx={12} ry={3} fill="#8a1a14" stroke={INK} strokeWidth={SW} />
          <path d="M22 62 C22 60 46 60 46 62" stroke={GOLD} strokeWidth={1.4} fill="none" />
          <path d="M31 80 H37 V82 H31 Z" fill={GOLD} stroke={INK} strokeWidth={0.5} />
          <path d="M26 68 C27 72 29 75 31 76" stroke={GOLD} strokeWidth={1} fill="none" strokeLinecap="round" />
        </g>
      ) : (
        <Mum cx={16} cy={72} r={8} fill="#f8e08a" tip="#a77b0a" />
      )}
    </g>
  );
}

/* 10월 단풍 */
function Maple({ special }: { special: boolean }) {
  const leaves: [number, number, number, number, string][] = [
    [18, 30, 2, -20, RED],
    [32, 22, 2.1, 15, "#e0721e"],
    [46, 34, 2, 30, RED],
    [26, 44, 1.8, -35, "#e0721e"],
    [40, 50, 1.9, 20, RED],
    [53, 56, 1.6, -10, "#e0721e"],
  ];
  return (
    <g>
      {!special && <Ribbon color={BLUE} x={5} y={36} />}
      <path d="M56 92 C48 76 38 62 24 48 C18 42 14 38 12 30 M36 62 C42 52 46 44 46 34 M30 54 C34 44 34 36 32 24" stroke={BROWN} strokeWidth={2.4} strokeLinecap="round" fill="none" />
      {leaves.map(([x, y, s, r, f], i) => (
        <Leaf key={i} x={x} y={y} s={s} rot={r} fill={f} />
      ))}
      {special && (
        <g strokeLinejoin="round" strokeLinecap="round">
          <path d="M20 74 V82 M26 74 V82 M38 74 V82 M44 74 V82" stroke="#8a5a2a" strokeWidth={2} />
          <ellipse cx={32} cy={69} rx={14} ry={6.5} fill="#b8743a" stroke={INK} strokeWidth={SW} />
          <path d="M42 66 C46 60 47 56 47 54" stroke="#b8743a" strokeWidth={5} fill="none" />
          <path d="M42 66 C46 60 47 56 47 54" stroke={INK} strokeWidth={0.5} fill="none" />
          <ellipse cx={48.5} cy={53.5} rx={4.2} ry={3} transform="rotate(-20 48.5 53.5)" fill="#c98a4c" stroke={INK} strokeWidth={SW} />
          <circle cx={48} cy={52.6} r={0.7} fill={INK} />
          <path d="M46 51 L44 47 M47 51 L47 45 L45 43 M47 45 L50 43 M47.5 50 L51 47 L52 44" stroke={INK} strokeWidth={0.9} fill="none" />
          <path d="M18 66 L15 62" stroke="#b8743a" strokeWidth={2} />
          {[
            [26, 66],
            [32, 64],
            [38, 67],
            [29, 71],
          ].map(([x, y], i) => (
            <circle key={i} cx={x} cy={y} r={0.9} fill={WHITE} />
          ))}
        </g>
      )}
    </g>
  );
}

export function HwatuArt({ month, special }: { month: number; special: boolean }) {
  switch (month) {
    case 1:
      return <Pine special={special} />;
    case 2:
      return <Plum special={special} />;
    case 3:
      return <Cherry special={special} />;
    case 4:
      return <Wisteria special={special} />;
    case 5:
      return <Iris special={special} />;
    case 6:
      return <PeonyArt special={special} />;
    case 7:
      return <BushClover special={special} />;
    case 8:
      return <Pampas special={special} />;
    case 9:
      return <Chrysanthemum special={special} />;
    case 10:
      return <Maple special={special} />;
    default:
      return null;
  }
}
