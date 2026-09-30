import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { RoomTable } from "./room-table";

export default async function RoomPage(props: PageProps<"/rooms/[id]">) {
  const { id } = await props.params;
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  return <RoomTable roomId={id} />;
}
