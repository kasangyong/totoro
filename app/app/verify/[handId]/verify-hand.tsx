"use client";

import { useMemo, useSyncExternalStore } from "react";
import { replay } from "@/lib/engine/replay";
import { autoClientSeed, commitOf, type SeedEntry } from "@/lib/engine/rng";
import { createSutdaHand, reduceSutda, sutdaDecks, type SutdaAction } from "@/lib/engine/sutda/game";
import { HwatuCard } from "@/app/rooms/[id]/hwatu-card";

export type RevealedHand = {
  rngVersion: string;
  serverSeed: string;
  clientSeeds: { seeds: SeedEntry[]; autoSeeded: string[] };
  baseBet: number;
  bossId: string;
  seats: { id: string; seatNo: number; stack: number }[];
  actionLog: SutdaAction[];
};

type Check = { label: string; ok: boolean | null; detail: string };

function readMySeed(handId: string): string | null {
  try {
    return localStorage.getItem(`bhmh.seed.${handId}`);
  } catch {
    return null;
  }
}

export function VerifyHand(props: {
  handId: string;
  handNo: number;
  commit: string;
  result: { payouts: Record<string, number> };
  revealed: RevealedHand;
  me: string;
}) {
  const { handId, commit, result, revealed, me } = props;
  // localStorage는 브라우저에만 있으므로 서버 렌더링 값은 null
  const mySeed = useSyncExternalStore(
    () => () => {},
    () => readMySeed(handId),
    () => null,
  );

  const outcome = useMemo(() => {
    try {
      const params = {
        handId,
        baseBet: revealed.baseBet,
        bossId: revealed.bossId,
        seats: revealed.seats,
        serverSeed: revealed.serverSeed,
        seeds: revealed.clientSeeds.seeds,
      };
      const final = replay(createSutdaHand(params), reduceSutda, revealed.actionLog);
      return { final, decks: sutdaDecks(params), error: null };
    } catch (e) {
      return { final: null, decks: [], error: e instanceof Error ? e.message : String(e) };
    }
  }, [handId, revealed]);

  const serverSeedMatches = commitOf(revealed.serverSeed) === commit;
  const payoutsMatch =
    outcome.final !== null && JSON.stringify(sortKeys(outcome.final.result!.payouts)) === JSON.stringify(sortKeys(result.payouts));
  const myEntry = revealed.clientSeeds.seeds.find((s) => s.userId === me);
  const wasAuto = revealed.clientSeeds.autoSeeded.includes(me);
  // "자동"이라고 표시된 시드는 누구나 다시 계산할 수 있어야 한다 (운영자가 임의 값을 끼워 넣지 못하게)
  const badAuto = revealed.clientSeeds.autoSeeded.filter(
    (id) => revealed.clientSeeds.seeds.find((s) => s.userId === id)?.clientSeed !== autoClientSeed(handId, id),
  );

  const checks: Check[] = [
    {
      label: "서버 시드가 판 시작 전 커밋과 같은가",
      ok: serverSeedMatches,
      detail: `SHA-256(서버 시드) = ${commit.slice(0, 16)}…`,
    },
    {
      label: "공개된 시드와 액션 기록으로 다시 돌린 결과가 실제 지급과 같은가",
      ok: outcome.error ? false : payoutsMatch,
      detail: outcome.error ?? `재경기 ${outcome.final?.rematchNo ?? 0}번 포함, 액션 ${revealed.actionLog.length}개 재생`,
    },
    {
      label: "자동 시드가 정해진 공식대로 만들어졌는가",
      ok: badAuto.length === 0,
      detail:
        revealed.clientSeeds.autoSeeded.length === 0
          ? "자동 시드 없음 (모두 직접 냈어요)."
          : badAuto.length === 0
            ? `${revealed.clientSeeds.autoSeeded.length}명 자동 시드 = SHA-256("auto|판|사용자") 앞 32자`
            : `공식과 다른 자동 시드: ${badAuto.map((id) => id.slice(0, 8)).join(", ")}`,
    },
    myEntry
      ? {
          label: "내 브라우저가 낸 시드가 그대로 쓰였는가",
          // 내가 시드를 냈는데(브라우저에 기록 있음) 서버가 "자동"이라고 하면 불일치
          ok: mySeed === null ? null : !wasAuto && mySeed === myEntry.clientSeed,
          detail:
            mySeed === null
              ? wasAuto
                ? "시간 안에 시드를 못 내서 자동 시드가 쓰였어요."
                : "이 브라우저에 저장된 시드가 없어요 (다른 기기에서 참가했을 수 있어요)."
              : wasAuto
                ? "내 브라우저는 시드를 냈는데 서버는 자동 시드를 썼다고 기록했어요."
                : `내 시드 ${mySeed.slice(0, 12)}…`,
        }
      : { label: "내 시드 대조", ok: null, detail: "이 판에 참가하지 않았어요." },
  ];

  return (
    <section className="mt-6 grid gap-4">
      <ul className="grid gap-2">
        {checks.map((c) => (
          <li key={c.label} className="panel flex items-start gap-3 p-4">
            <span
              className={`mt-0.5 font-display text-xl ${c.ok === true ? "text-win" : c.ok === false ? "text-bust" : "text-muted"}`}
              aria-label={c.ok === true ? "일치" : c.ok === false ? "불일치" : "확인 불가"}
            >
              {c.ok === true ? "✓" : c.ok === false ? "✗" : "–"}
            </span>
            <div>
              <p className="font-bold">{c.label}</p>
              <p className="text-xs break-all text-muted">{c.detail}</p>
            </div>
          </li>
        ))}
      </ul>

      <div className="panel p-4">
        <p className="mb-2 text-sm font-bold text-accent">공개된 재료 (RNG {revealed.rngVersion})</p>
        <p className="text-xs break-all text-muted">서버 시드: {revealed.serverSeed}</p>
        {revealed.clientSeeds.seeds.map((s) => (
          <p key={s.userId} className="text-xs break-all text-muted">
            {s.userId.slice(0, 8)}… 시드: {s.clientSeed}
            {revealed.clientSeeds.autoSeeded.includes(s.userId) && " (자동)"}
          </p>
        ))}
      </div>

      {outcome.decks[0] && (
        <div className="panel p-4">
          <p className="mb-2 text-sm font-bold text-accent">첫 경기 덱 순서 (앞에서부터 보스 기준으로 한 장씩 돌림)</p>
          <div className="flex flex-wrap gap-1">
            {outcome.decks[0].map((c, i) => (
              <HwatuCard key={i} card={c} small />
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

function sortKeys(o: Record<string, number>): Record<string, number> {
  return Object.fromEntries(Object.entries(o).sort(([a], [b]) => (a < b ? -1 : 1)));
}
