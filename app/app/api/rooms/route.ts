import { handle, readJson, requireUser } from "@/lib/rooms/http";
import { createRoom } from "@/lib/rooms/service";

export async function POST(request: Request) {
  return handle(async () => {
    const userId = await requireUser();
    const body = await readJson(request);
    return {
      id: await createRoom(userId, {
        name: String(body.name ?? ""),
        baseBet: Number(body.baseBet),
        maxSeats: Number(body.maxSeats),
      }),
    };
  });
}
