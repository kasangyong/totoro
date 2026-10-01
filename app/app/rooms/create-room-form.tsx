"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

export function CreateRoomForm() {
  const router = useRouter();
  const [game, setGame] = useState<"sutda" | "poker7" | "blackjack">("sutda");
  const [name, setName] = useState("한 판 하자");
  const [baseBet, setBaseBet] = useState(100);
  const [maxSeats, setMaxSeats] = useState(6);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch("/api/rooms", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, baseBet, maxSeats, game }),
    });
    const body: { data?: { id: string }; error?: string } = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok || !body.data) return setError(body.error ?? "방을 만들지 못했어요.");
    router.push(`/rooms/${body.data.id}`);
  }

  return (
    <form onSubmit={submit} className="panel mt-6 grid gap-3 p-5 sm:grid-cols-[auto_1fr_auto_auto_auto] sm:items-end">
      <label className="flex flex-col gap-1 text-sm">
        게임
        <select className="field" value={game} onChange={(e) => setGame(e.target.value as "sutda" | "poker7" | "blackjack")}>
          <option value="sutda">섯다</option>
          <option value="poker7">7포커</option>
          <option value="blackjack">블랙잭</option>
        </select>
      </label>
      <label className="flex flex-col gap-1 text-sm">
        방 이름
        <input className="field" value={name} maxLength={30} onChange={(e) => setName(e.target.value)} required />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        기본금(P)
        <input
          className="field w-28"
          type="number"
          min={1}
          max={100000}
          value={baseBet}
          onChange={(e) => setBaseBet(Number(e.target.value))}
          required
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        최대 인원
        <select className="field" value={maxSeats} onChange={(e) => setMaxSeats(Number(e.target.value))}>
          {[2, 3, 4, 5, 6].map((n) => (
            <option key={n} value={n}>
              {n}명
            </option>
          ))}
        </select>
      </label>
      <button type="submit" className="btn-main px-5 py-2.5" disabled={busy}>
        방 만들기
      </button>
      {error && (
        <p role="alert" className="text-sm text-bust sm:col-span-5">
          {error}
        </p>
      )}
    </form>
  );
}
