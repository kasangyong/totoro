"use client";
import { createBrowserClient } from "@supabase/ssr";
import { supabaseAnonKey, supabaseUrl } from "./env";

export function supabaseBrowser() {
  return createBrowserClient(supabaseUrl(), supabaseAnonKey());
}
