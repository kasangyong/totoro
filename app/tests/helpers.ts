import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import postgres from "postgres";
import { usernameToEmail } from "../lib/auth";
import type { Poker7View } from "../lib/engine/poker7/game";
import type { SutdaView } from "../lib/engine/sutda/game";
import type { RoomView } from "../lib/rooms/service";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export const admin = () => createClient(url, serviceKey, { auth: { persistSession: false } });
export const anon = () => createClient(url, anonKey, { auth: { persistSession: false } });
export const sql = () => postgres(process.env.SUPABASE_DB_URL!, { max: 4, onnotice: () => {} });

export const PASSWORD = "test-password-1";

export function uniqueName(prefix = "t"): string {
  return `${prefix}${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`.slice(0, 16);
}

/** 가입 API와 같은 경로(service role createUser)로 사용자를 만들고 로그인한 클라이언트를 돌려준다 */
export async function createUser(username = uniqueName()): Promise<{ id: string; client: SupabaseClient; username: string }> {
  const { data, error } = await admin().auth.admin.createUser({
    email: usernameToEmail(username),
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { username },
  });
  if (error) throw error;
  const client = anon();
  const { error: signInError } = await client.auth.signInWithPassword({ email: usernameToEmail(username), password: PASSWORD });
  if (signInError) throw signInError;
  return { id: data.user.id, client, username };
}

/** 섯다·포커 방 테스트용: 상태 응답의 게임을 카드 게임 view로 본다 */
export const cardGame = (v: RoomView) => v.game as SutdaView | Poker7View;
