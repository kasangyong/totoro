import Link from "next/link";
import { redirect } from "next/navigation";
import { gameLabel } from "@/lib/rooms/labels";
import { supabaseServer } from "@/lib/supabase/server";
import { CreateRoomForm } from "./create-room-form";

export default async function RoomsPage() {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: rooms } = await supabase
    .from("rooms")
    .select("id, name, game, base_bet, max_seats, status, room_seats(count)")
    .neq("status", "closed")
    .order("created_at", { ascending: false });

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-6">
      <header className="flex items-center justify-between border-b border-accent/30 pb-4">
        <Link href="/" className="rounded-full border border-gold-dim px-3 py-1 text-sm font-bold text-accent">
          ‹ 로비
        </Link>
        <h1 className="font-display text-3xl tracking-widest">ROOMS</h1>
        <span className="w-16" />
      </header>

      <CreateRoomForm />

      <h2 className="mt-8 mb-3 text-sm font-bold tracking-widest text-accent">열린 방</h2>
      {!rooms?.length && <p className="text-sm text-muted">아직 열린 방이 없어요. 위에서 만들어 보세요.</p>}
      <ul className="grid gap-3">
        {rooms?.map((r) => {
          const count = (r.room_seats as unknown as { count: number }[])[0]?.count ?? 0;
          return (
            <li key={r.id}>
              <Link href={`/rooms/${r.id}`} className="panel flex items-center justify-between p-4 transition hover:-translate-y-0.5">
                <div>
                  <p className="font-bold">{r.name}</p>
                  <p className="text-xs text-muted">
                    {gameLabel(r.game)} · 기본금 {r.base_bet.toLocaleString("ko-KR")}P · {r.status === "playing" ? "진행 중" : "대기 중"}
                  </p>
                </div>
                <span className="font-display text-xl text-accent">
                  {count} / {r.max_seats}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </main>
  );
}
