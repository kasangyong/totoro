import Link from "next/link";
import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { VerifyHand, type RevealedHand } from "./verify-hand";

export default async function VerifyPage(props: PageProps<"/verify/[handId]">) {
  const { handId } = await props.params;
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: hand } = await supabase
    .from("hands")
    .select("id, room_id, hand_no, commit_hash, status, result, revealed")
    .eq("id", handId)
    .single();

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-6">
      <header className="flex items-center justify-between border-b border-accent/30 pb-4">
        {hand ? (
          <Link href={`/rooms/${hand.room_id}`} className="rounded-full border border-gold-dim px-3 py-1 text-sm font-bold text-accent">
            ‹ 방으로
          </Link>
        ) : (
          <span />
        )}
        <h1 className="font-display text-2xl tracking-widest">VERIFY</h1>
        <span className="w-16" />
      </header>
      {!hand && <p className="mt-6 text-muted">판을 찾지 못했어요.</p>}
      {hand && hand.status !== "done" && (
        <p className="mt-6 text-muted">
          {hand.status === "void" ? "무효 처리된 판이라 검증할 결과가 없어요." : "아직 진행 중인 판이에요. 끝나면 시드가 공개돼요."}
        </p>
      )}
      {hand && hand.status === "done" && hand.revealed && (
        <VerifyHand
          handId={hand.id}
          handNo={hand.hand_no}
          commit={hand.commit_hash}
          result={hand.result as { payouts: Record<string, number>; hands?: unknown; dealer?: unknown }}
          revealed={hand.revealed as RevealedHand}
          me={user.id}
        />
      )}
      <p className="mt-8 text-xs leading-relaxed text-muted">
        한계: 운영자는 진행 중인 판의 패를 DB에서 볼 수 있고, 다른 계정으로 참가할 수도 있어요. 대신 섞는 순서는 판 시작 전에 커밋(해시)으로
        고정되고, 참가자 시드가 섞여 들어가므로 판이 시작된 뒤에는 누구도 바꿀 수 없어요.
      </p>
    </main>
  );
}
