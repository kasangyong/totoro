import Link from "next/link";
import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { DailyClaims } from "./daily-claims";
import { SignOutButton } from "./sign-out-button";

const SOLO_GAMES = [
  { name: "CRASH", ko: "크래시 · 다 같이", desc: "배율이 오르다 터져요. 터지기 전에 빼면 이겨요.", href: "/games/crash.html" },
  { name: "MINES", ko: "지뢰찾기", desc: "지뢰를 피해 보석을 열수록 배율이 올라가요.", href: "/games/mines.html" },
  { name: "PLINKO", ko: "플링코", desc: "공이 핀에 튕기며 떨어져 아래 칸 배율만큼 받아요.", href: "/games/plinko.html" },
  { name: "CHICKEN", ko: "치킨 크로싱", desc: "한 칸씩 건널수록 배율이 올라가요.", href: "/games/chicken.html" },
  { name: "HILO", ko: "하이로", desc: "다음 카드가 높을지 낮을지 맞혀요.", href: "/games/hilo.html" },
  { name: "DICE · LIMBO · WHEEL", ko: "빠른 게임", desc: "한 번에 결과가 나오는 게임 셋.", href: "/games/quick.html" },
];

export default async function Lobby() {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: profile } = await supabase.from("profiles").select("username, balance").eq("id", user.id).single();
  if (!profile) redirect("/login");

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-6">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-accent/30 pb-4">
        <div>
          <h1 className="font-logo text-4xl text-accent sm:text-5xl">
            배팅 <span className="text-fg/60">♠</span> 할래 <span className="text-fg/60">♦</span> 말래
          </h1>
          <p className="mt-1 text-sm text-muted">{profile.username}님 · 실제 돈은 쓰지 않아요</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 rounded-full border border-gold-dim bg-panel py-1.5 pr-4 pl-2">
            <span className="chip-coin" aria-hidden />
            <span className="text-xs text-muted">보유</span>
            <b className="font-display text-2xl text-accent">{profile.balance.toLocaleString("ko-KR")}</b>
            <span className="text-sm">P</span>
          </div>
          <SignOutButton />
        </div>
      </header>

      <DailyClaims />

      <h2 className="mt-8 mb-3 text-sm font-bold tracking-widest text-accent">여럿이 하는 방</h2>
      <div className="grid gap-4 sm:grid-cols-2">
        <Link href="/rooms" className="panel block p-5 transition hover:-translate-y-0.5">
          <div className="flex items-baseline justify-between">
            <span className="font-display text-2xl tracking-widest">SUTDA</span>
            <span className="text-sm text-muted">섯다</span>
          </div>
          <p className="mt-2 text-sm text-muted">방을 만들어 2~6명이 함께. 판마다 섞은 순서를 검증할 수 있어요.</p>
        </Link>
        <Link href="/rooms" className="panel block p-5 transition hover:-translate-y-0.5">
          <div className="flex items-baseline justify-between">
            <span className="font-display text-2xl tracking-widest">POKER</span>
            <span className="text-sm text-muted">7포커</span>
          </div>
          <p className="mt-2 text-sm text-muted">초이스 룰 세븐포커. 4장 받아 1장 버리고 1장 공개, 히든까지.</p>
        </Link>
      </div>

      <div className="mt-8 mb-3 flex items-baseline justify-between">
        <h2 className="text-sm font-bold tracking-widest text-accent">빠르게 한 판</h2>
        <Link href="/fair" className="text-xs text-muted underline">공정성 · 내 시드 확인</Link>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {SOLO_GAMES.map((g) => (
          // public/games/*.html은 Next 라우트가 아니라 정적 파일이라 <a>로 이동
          <a key={g.name} href={g.href} className="panel block p-5 transition hover:-translate-y-0.5">
            <div className="flex items-baseline justify-between gap-2">
              <span className="font-display text-xl tracking-widest">{g.name}</span>
              <span className="text-sm text-muted">{g.ko}</span>
            </div>
            <p className="mt-2 text-sm text-muted">{g.desc}</p>
          </a>
        ))}
      </div>
    </main>
  );
}
