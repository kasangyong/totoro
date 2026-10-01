import Link from "next/link";
import { FairPanel } from "./fair-panel";

export default function FairPage() {
  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-6">
      <header className="flex items-center justify-between border-b border-accent/30 pb-4">
        <Link href="/" className="rounded-full border border-gold-dim px-3 py-1 text-sm font-bold text-accent">
          ‹ 로비
        </Link>
        <h1 className="font-display text-2xl tracking-widest">FAIRNESS</h1>
        <span className="w-16" />
      </header>
      <p className="mt-4 text-sm leading-relaxed text-muted">
        혼자 하는 게임의 결과는 <b className="text-fg">서버 시드 + 내 클라이언트 시드 + 판 번호(nonce)</b>로 정해져요. 서버 시드는
        해시만 먼저 보여 주고, 시드를 바꾸면 그때 원본을 공개해요. 공개된 시드로 지난 판을 아래에서 직접 다시 계산해 볼 수 있어요.
      </p>
      <FairPanel />
    </main>
  );
}
