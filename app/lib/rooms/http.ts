import { NextResponse } from "next/server";
import { BettingError } from "../engine/betting";
import { Poker7Error } from "../engine/poker7/game";
import { SutdaError } from "../engine/sutda/game";
import { supabaseServer } from "../supabase/server";
import { RoomError } from "./service";

/** 로그인 사용자 id (요청 body의 값은 절대 믿지 않는다) */
export async function requireUser(): Promise<string> {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new RoomError("로그인이 필요해요.", 401);
  return user.id;
}

export async function readJson(request: Request): Promise<Record<string, unknown>> {
  const body: unknown = await request.json().catch(() => ({}));
  return typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
}

export async function handle(fn: () => Promise<unknown>) {
  try {
    const data = await fn();
    return NextResponse.json({ ok: true, data: data ?? null });
  } catch (e) {
    if (e instanceof RoomError) return NextResponse.json({ error: e.message }, { status: e.status });
    // 형식이 틀린 id (uuid 아님) → 없는 방
    if (typeof e === "object" && e !== null && "code" in e && (e as { code: unknown }).code === "22P02") {
      return NextResponse.json({ error: "방이 없어요." }, { status: 404 });
    }
    // 게임 규칙 위반(엔진 예외)은 400, 나머지는 500
    if (e instanceof SutdaError || e instanceof Poker7Error || e instanceof BettingError) {
      return NextResponse.json({ error: "지금 할 수 없는 동작이에요." }, { status: 400 });
    }
    console.error(e);
    return NextResponse.json({ error: "서버 오류가 났어요." }, { status: 500 });
  }
}
