import type { NextRequest } from "next/server";
import { handle, readJson, requireUser } from "@/lib/rooms/http";
import {
  cashoutSession,
  GameError,
  getSession,
  INSTANT_GAMES,
  playInstant,
  SESSION_GAMES,
  startSession,
  stepSession,
  type InstantGame,
  type SessionGame,
} from "@/lib/solo/service";

const isInstant = (g: string): g is InstantGame => (INSTANT_GAMES as readonly string[]).includes(g);
const isSession = (g: string): g is SessionGame => (SESSION_GAMES as readonly string[]).includes(g);

// 단판: POST /api/solo/{dice|limbo|wheel|plinko}/play  { bet, params }
// 세션: POST /api/solo/{mines|chicken|hilo}/{state|start|step|cashout}
export async function POST(request: NextRequest, ctx: RouteContext<"/api/solo/[game]/[op]">) {
  return handle(async () => {
    const userId = await requireUser();
    const { game, op } = await ctx.params;
    const body = await readJson(request);
    const params = typeof body.params === "object" && body.params !== null ? (body.params as Record<string, unknown>) : {};
    if (isInstant(game) && op === "play") return playInstant(userId, game, Number(body.bet), params);
    if (isSession(game)) {
      switch (op) {
        case "state":
          return getSession(userId, game);
        case "start":
          return startSession(userId, game, Number(body.bet), params);
        case "step":
          return stepSession(userId, game, params);
        case "cashout":
          return cashoutSession(userId, game);
      }
    }
    throw new GameError("없는 요청이에요.", 404);
  });
}
