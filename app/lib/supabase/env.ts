function required(name: string, value: string | undefined): string {
  if (!value) throw new Error(`환경변수 ${name}가 없습니다. app/.env.local을 확인하세요.`);
  return value;
}

// NEXT_PUBLIC_ 값은 빌드 시 문자열로 치환되므로 process.env.X 형태로 직접 읽어야 한다.
export const supabaseUrl = () => required("NEXT_PUBLIC_SUPABASE_URL", process.env.NEXT_PUBLIC_SUPABASE_URL);
export const supabaseAnonKey = () =>
  required("NEXT_PUBLIC_SUPABASE_ANON_KEY", process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
export const supabaseServiceKey = () =>
  required("SUPABASE_SERVICE_ROLE_KEY", process.env.SUPABASE_SERVICE_ROLE_KEY);
