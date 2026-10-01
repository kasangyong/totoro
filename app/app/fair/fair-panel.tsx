"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { commitOf } from "@/lib/engine/rng";
import { verifyCrashRound, verifySoloBet } from "@/lib/engine/solo/verify";

type Pair = { id: string; commit_hash: string; client_seed: string; server_seed: string | null; created_at: string };
type Bet = {
  id: string;
  game: string;
  nonce: number;
  seed_pair_id: string;
  stake: number;
  payout: number | null;
  params: Record<string, unknown>;
  state: Record<string, unknown>;
  status: string;
  created_at: string;
};
type Fair = {
  rngVersion: string;
  current: { seedPairId: string; commit: string; clientSeed: string; nonce: number };
  revealed: Pair[];
  bets: Bet[];
  crashRounds: { round_no: number; commit_hash: string; seed: string; crash_point100: number }[];
};

export function FairPanel() {
  const router = useRouter();
  const [fair, setFair] = useState<Fair | null>(null);
  const [me, setMe] = useState<string | null>(null);
  const [clientSeed, setClientSeed] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [checked, setChecked] = useState<Record<string, boolean>>({});

  const load = useCallback(async () => {
    const res = await fetch("/api/fair", { cache: "no-store" });
    if (res.status === 401) {
      router.replace("/login");
      return;
    }
    const body: { data?: Fair; error?: string } = await res.json();
    if (body.data) setFair(body.data);
    else setMessage(body.error ?? "불러오지 못했어요.");
  }, [router]);

  useEffect(() => {
    const t = setTimeout(() => void load(), 0);
    // 내 user id는 시드 재계산에 들어간다 (RNG v1의 seed_material = user_id=client_seed)
    void import("@/lib/supabase/browser").then(async ({ supabaseBrowser }) => {
      const { data } = await supabaseBrowser().auth.getUser();
      setMe(data.user?.id ?? null);
    });
    return () => clearTimeout(t);
  }, [load]);

  async function rotate() {
    setMessage(null);
    const res = await fetch("/api/fair", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ clientSeed: clientSeed.trim() }),
    });
    const body: { data?: { revealedServerSeed: string }; error?: string } = await res.json();
    if (!res.ok) return setMessage(body.error ?? "바꾸지 못했어요.");
    setMessage(`이전 서버 시드를 공개했어요: ${body.data!.revealedServerSeed.slice(0, 16)}…`);
    setClientSeed("");
    await load();
  }

  function checkAll() {
    if (!fair || !me) return;
    const pairs = new Map(fair.revealed.map((p) => [p.id, p]));
    const result: Record<string, boolean> = {};
    for (const b of fair.bets) {
      const pair = pairs.get(b.seed_pair_id);
      if (pair) result[b.id] = verifySoloBet(b, { serverSeed: pair.server_seed!, clientSeed: pair.client_seed, userId: me });
    }
    setChecked(result);
  }

  if (!fair) return <p className="mt-6 text-muted">{message ?? "불러오는 중…"}</p>;
  const revealedIds = new Set(fair.revealed.map((p) => p.id));

  return (
    <div className="mt-6 grid gap-4">
      <section className="panel grid gap-2 p-4 text-sm">
        <p className="font-bold text-accent">지금 쓰는 시드 (RNG {fair.rngVersion})</p>
        <p className="break-all text-muted">서버 시드 해시: {fair.current.commit}</p>
        <p className="break-all text-muted">클라이언트 시드: {fair.current.clientSeed}</p>
        <p className="text-muted">다음 판 번호(nonce): {fair.current.nonce}</p>
        <div className="mt-2 flex flex-wrap items-end gap-2">
          <label className="flex flex-1 flex-col gap-1 text-xs">
            새 클라이언트 시드 (비우면 자동 · 소문자 16진수 32자)
            <input className="field font-mono" value={clientSeed} maxLength={32} onChange={(e) => setClientSeed(e.target.value)} />
          </label>
          <button className="btn-main px-4 py-2" onClick={rotate}>
            시드 바꾸고 지금 서버 시드 공개
          </button>
        </div>
        {message && (
          <p role="status" className="text-accent">
            {message}
          </p>
        )}
      </section>

      <section className="panel p-4 text-sm">
        <div className="mb-2 flex items-center justify-between">
          <p className="font-bold text-accent">최근 판</p>
          <button className="btn-ghost px-3 py-1 text-xs" onClick={checkAll} disabled={!me}>
            공개된 시드로 다시 계산
          </button>
        </div>
        {fair.bets.length === 0 && <p className="text-muted">아직 기록이 없어요.</p>}
        <ul className="grid gap-1">
          {fair.bets.map((b) => {
            const revealed = revealedIds.has(b.seed_pair_id);
            const ok = checked[b.id];
            return (
              <li key={b.id} className="flex items-center justify-between gap-2 border-b border-line/50 py-1">
                <span>
                  {b.game} · #{b.nonce} · {b.stake.toLocaleString("ko-KR")}P → {(b.payout ?? 0).toLocaleString("ko-KR")}P
                </span>
                <span className={ok === true ? "text-win" : ok === false ? "text-bust" : "text-muted"}>
                  {ok === true ? "✓ 일치" : ok === false ? "✗ 불일치" : revealed ? "확인 가능" : "시드 공개 전"}
                </span>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="panel p-4 text-xs text-muted">
        <p className="mb-1 font-bold text-accent">최근 Crash 라운드 (모두 같은 판)</p>
        <p className="mb-1">라운드마다 시드 해시를 먼저 공개하고, 터진 뒤 시드를 공개해요. 시드로 터지는 배율을 다시 계산해요.</p>
        <p className="mb-1">한계: 커밋한 뒤에는 바꿀 수 없지만, 운영자가 커밋하기 전에 시드를 골라 쓰는 것까지는 막지 못해요.</p>
        {fair.crashRounds.map((r) => {
          const ok = verifyCrashRound({ commit: r.commit_hash, seed: r.seed, crashPoint100: r.crash_point100 });
          return (
            <p key={r.round_no} className={ok ? "" : "text-bust"}>
              {ok ? "✓" : "✗"} #{r.round_no} · {(r.crash_point100 / 100).toFixed(2)}× · 시드 {r.seed.slice(0, 16)}…
            </p>
          );
        })}
        {fair.crashRounds.length === 0 && <p>아직 끝난 라운드가 없어요.</p>}
      </section>

      <section className="panel p-4 text-xs text-muted">
        <p className="mb-1 font-bold text-accent">공개된 지난 시드</p>
        {fair.revealed.map((p) => (
          <p key={p.id} className="break-all">
            {commitOf(p.server_seed!) === p.commit_hash ? "✓" : "✗"} {p.server_seed} (해시 {p.commit_hash.slice(0, 10)}…)
          </p>
        ))}
        {fair.revealed.length === 0 && <p>아직 없어요. 위에서 시드를 바꾸면 지금 시드가 공개돼요.</p>}
      </section>
    </div>
  );
}
