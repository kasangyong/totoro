import { handle, readJson, requireUser } from "@/lib/rooms/http";
import { engineDb } from "@/lib/rooms/db";
import { getFairness, recentBets, rotateSeed } from "@/lib/solo/service";

// GET: 지금 시드 쌍(서버 시드는 해시만)과 공개된 지난 시드, 최근 판 기록
export async function GET() {
  return handle(async () => {
    const userId = await requireUser();
    const crashRounds = await engineDb()`
      select round_no, commit_hash, seed, crash_point100 from public.crash_rounds
      where status = 'crashed' order by round_no desc limit 10`;
    return { ...(await getFairness(userId)), bets: await recentBets(userId), crashRounds };
  });
}

// POST { clientSeed? }: 지금 서버 시드를 공개하고 새 시드 쌍으로 교체
export async function POST(request: Request) {
  return handle(async () => {
    const userId = await requireUser();
    const body = await readJson(request);
    return rotateSeed(userId, typeof body.clientSeed === "string" && body.clientSeed !== "" ? body.clientSeed : undefined);
  });
}
