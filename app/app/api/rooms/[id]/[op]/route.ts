import type { NextRequest } from "next/server";
import type { LegalAction } from "@/lib/rooms/games";
import { handle, readJson, requireUser } from "@/lib/rooms/http";
import { act, choose, openCard, pickCards, rejoin, RoomError, sit, stand, start, submitSeed, tick } from "@/lib/rooms/service";

const ACTIONS: readonly LegalAction[] = [
  "check", "ping", "call", "ddadang", "quarter", "half", "die",
  // 블랙잭
  "bet", "sit_out", "hit", "stand", "double", "split",
];

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
        const action = body.action as LegalAction;
        if (!ACTIONS.includes(action)) throw new RoomError("알 수 없는 액션이에요.");
        const amount = body.amount === undefined ? undefined : Number(body.amount);
        return act(userId, id, action, Number(body.expectedSeq), amount);
      }
      case "rejoin":
        return rejoin(userId, id, body.join === true);
      case "choose": {
        const { discard, open } = body;
        if (!Number.isInteger(discard) || !Number.isInteger(open)) throw new RoomError("카드를 골라 주세요.");
        return choose(userId, id, discard as number, open as number);
      }
      case "open": {
        if (!Number.isInteger(body.card)) throw new RoomError("카드를 골라 주세요.");
        return openCard(userId, id, body.card as number);
      }
      case "pick": {
        const cards = body.cards;
        if (!Array.isArray(cards) || cards.length !== 2 || !cards.every((c) => Number.isInteger(c))) throw new RoomError("카드 2장을 골라 주세요.");
        return pickCards(userId, id, [cards[0] as number, cards[1] as number]);
      }
      case "tick":
        return tick(id);
      default:
        throw new RoomError("없는 요청이에요.", 404);
    }
  });
}
