"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/browser";

const MESSAGES: Record<string, string> = {
  "already claimed today": "오늘은 이미 받았어요.",
  "balance too high for rescue": "보유 포인트가 100P보다 적을 때만 받을 수 있어요.",
};

export function DailyClaims() {
  const router = useRouter();
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function claim(fn: "claim_attendance" | "claim_rescue", label: string) {
    setBusy(true);
    const { error } = await supabaseBrowser().rpc(fn);
    setBusy(false);
    setNote(error ? (MESSAGES[error.message] ?? "받지 못했어요.") : `${label}를 받았어요.`);
    if (!error) router.refresh();
  }

  return (
    <section className="mt-6 grid gap-3 sm:grid-cols-2">
      <ClaimCard
        title="오늘 출석 보너스 500P"
        hint="하루에 한 번 받을 수 있어요"
        busy={busy}
        primary
        onClick={() => claim("claim_attendance", "출석 보너스")}
      />
      <ClaimCard
        title="파산 구제금 1,000P"
        hint="보유 포인트가 100P보다 적을 때 하루 한 번"
        busy={busy}
        onClick={() => claim("claim_rescue", "구제금")}
      />
      {note && (
        <p role="status" className="text-sm text-accent sm:col-span-2">
          {note}
        </p>
      )}
    </section>
  );
}

function ClaimCard(props: { title: string; hint: string; busy: boolean; primary?: boolean; onClick: () => void }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-2xl border border-dashed border-gold-dim bg-black/15 p-4">
      <div>
        <p className="font-bold">{props.title}</p>
        <p className="text-xs text-muted">{props.hint}</p>
      </div>
      <button
        type="button"
        onClick={props.onClick}
        disabled={props.busy}
        className={props.primary ? "btn-main px-5 py-2" : "btn-ghost px-5 py-2"}
      >
        받기
      </button>
    </div>
  );
}
