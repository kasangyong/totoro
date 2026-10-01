import type { NextRequest } from "next/server";
import type { BetActionType } from "@/lib/engine/betting";
import { handle, readJson, requireUser } from "@/lib/rooms/http";
import { act, choose, rejoin, RoomError, sit, stand, start, submitSeed, tick } from "@/lib/rooms/service";

const BET_ACTIONS: readonly BetActionType[] = ["check", "ping", "call", "ddadang", "quarter", "half", "die"];

export async function POST(request: NextRequest, ctx: RouteContext<"/api/rooms/[id]/[op]">) {
  return handle(async () => {
    const userId = await requireUser();
    const { id, op } = await ctx.params;
    const body = await readJson(request);
    switch (op) {
      case "sit":
        return sit(userId, id, Number(body.buyIn));
      case "stand":
        return stand(userId, id);
      case "start":
        return start(userId, id);
      case "seed":
        return submitSeed(userId, id, String(body.clientSeed ?? ""));
      case "act": {
        const action = body.action as BetActionType;
        if (!BET_ACTIONS.includes(action)) throw new RoomError("알 수 없는 액션이에요.");
        return act(userId, id, action, Number(body.expectedSeq));
      }
      case "rejoin":
        return rejoin(userId, id, body.join === true);
      case "choose": {
        const { discard, open } = body;
        if (!Number.isInteger(discard) || !Number.isInteger(open)) throw new RoomError("카드를 골라 주세요.");
        return choose(userId, id, discard as number, open as number);
      }
      case "tick":
        return tick(id);
      default:
        throw new RoomError("없는 요청이에요.", 404);
    }
  });
}
