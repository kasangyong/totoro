"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

// 게임을 고르면 방식을 고른다 (sutda3-arch.md 결정 4). 값은 방 종류(rooms.game) 그대로.
const FAMILIES = [
  { key: "sutda", label: "섯다", variants: [{ value: "sutda", label: "2장" }, { value: "sutda3", label: "3장" }] },
  { key: "poker", label: "포커", variants: [{ value: "poker7", label: "세븐포커" }, { value: "holdem", label: "홀덤" }] },
  { key: "blackjack", label: "블랙잭", variants: [{ value: "blackjack", label: "블랙잭" }] },
] as const;

export function CreateRoomForm() {
  const router = useRouter();
  const [family, setFamily] = useState<(typeof FAMILIES)[number]["key"]>("sutda");
  const [game, setGame] = useState<(typeof FAMILIES)[number]["variants"][number]["value"]>("sutda");
  const variants = FAMILIES.find((f) => f.key === family)!.variants;
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
    <form onSubmit={submit} className={`panel mt-6 grid gap-3 p-5 sm:items-end ${
        // 방식 칸이 없으면(블랙잭) 5열: 방 이름이 남는 폭을 쓰게
        variants.length > 1 ? "sm:grid-cols-[auto_auto_minmax(0,1fr)_auto_auto_auto]" : "sm:grid-cols-[auto_minmax(0,1fr)_auto_auto_auto]"
      }`}>
      <label className="flex flex-col gap-1 text-sm">
        게임
        <select
          className="field"
          value={family}
          onChange={(e) => {
            const next = FAMILIES.find((f) => f.key === e.target.value)!;
            setFamily(next.key);
            setGame(next.variants[0].value);
          }}
        >
          {FAMILIES.map((f) => (
            <option key={f.key} value={f.key}>
              {f.label}
            </option>
          ))}
        </select>
      </label>
      {variants.length > 1 && (
        <label className="flex flex-col gap-1 text-sm">
          방식
          <select className="field" value={game} onChange={(e) => setGame(e.target.value as typeof game)}>
            {variants.map((v) => (
              <option key={v.value} value={v.value}>
                {v.label}
              </option>
            ))}
          </select>
        </label>
      )}
      <label className="flex flex-col gap-1 text-sm">
        방 이름
        <input className="field w-full min-w-0" value={name} maxLength={30} onChange={(e) => setName(e.target.value)} required />
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
      <button type="submit" className="btn-main whitespace-nowrap px-5 py-2.5" disabled={busy}>
        방 만들기
      </button>
      {error && (
        <p role="alert" className="text-sm text-bust sm:col-span-full">
          {error}
        </p>
      )}
    </form>
  );
}
