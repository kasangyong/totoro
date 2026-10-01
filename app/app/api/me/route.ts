import { handle, requireUser } from "@/lib/rooms/http";
import { supabaseServer } from "@/lib/supabase/server";

// 게임 페이지가 지갑을 표시할 때 쓰는 내 정보
export async function GET() {
  return handle(async () => {
    const userId = await requireUser();
    const supabase = await supabaseServer();
    const { data } = await supabase.from("profiles").select("username, balance").eq("id", userId).single();
    return data;
  });
}
