import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { usernameToEmail } from "@/lib/auth";

const USERNAME_RE = /^[a-z0-9_]{3,16}$/;

// 가입은 여기서만 받는다 (Supabase 공개 가입은 config.toml에서 꺼 둠).
export async function POST(request: Request) {
  const body: unknown = await request.json().catch(() => null);
  if (typeof body !== "object" || body === null) return fail("잘못된 요청이에요.", 400);
  const { username, password, inviteCode } = body as Record<string, unknown>;
  if (typeof username !== "string" || !USERNAME_RE.test(username.toLowerCase())) {
    return fail("아이디는 영문 소문자·숫자·_ 3~16자예요.", 400);
  }
  // bcrypt 한도는 72바이트 (한글은 글자당 3바이트)
  if (typeof password !== "string" || password.length < 6 || new TextEncoder().encode(password).length > 72) {
    return fail("비밀번호는 6자 이상, 영문 기준 72자(한글 24자) 이하예요.", 400);
  }
  if (typeof inviteCode !== "string") return fail("초대코드를 입력해 주세요.", 400);

  const admin = supabaseAdmin();
  const { data: ok, error: inviteError } = await admin.rpc("verify_invite_code", { p_code: inviteCode });
  if (inviteError) return fail("초대코드를 확인하지 못했어요.", 500);
  if (!ok) return fail("초대코드가 맞지 않아요.", 403);

  const name = username.toLowerCase();
  const { error } = await admin.auth.admin.createUser({
    email: usernameToEmail(name),
    password,
    email_confirm: true,
    user_metadata: { username: name },
  });
  if (error) {
    const taken = /already|exists|registered|duplicate/i.test(error.message);
    return fail(taken ? "이미 있는 아이디예요." : "가입하지 못했어요.", taken ? 409 : 500);
  }
  return NextResponse.json({ ok: true });
}

function fail(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}
