import type { NextRequest } from "next/server";
import { handle, requireUser } from "@/lib/rooms/http";
import { getRoomView } from "@/lib/rooms/service";

export async function GET(_request: NextRequest, ctx: RouteContext<"/api/rooms/[id]">) {
  return handle(async () => {
    const userId = await requireUser();
    const { id } = await ctx.params;
    return getRoomView(userId, id);
  });
}
