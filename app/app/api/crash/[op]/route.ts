import type { NextRequest } from "next/server";
import { handle, readJson, requireUser } from "@/lib/rooms/http";
import { crashBet, crashCashout, crashState } from "@/lib/solo/crash-service";
import { GameError } from "@/lib/solo/service";

// POST /api/crash/state · /bet { stake, auto100 } · /cashout
export async function POST(request: NextRequest, ctx: RouteContext<"/api/crash/[op]">) {
  return handle(async () => {
    const userId = await requireUser();
    const { op } = await ctx.params;
    const body = await readJson(request);
    if (op === "state") return crashState(userId);
    if (op === "bet") return crashBet(userId, Number(body.stake), body.auto100 == null ? null : Number(body.auto100));
    if (op === "cashout") return crashCashout(userId);
    throw new GameError("없는 요청이에요.", 404);
  });
}
