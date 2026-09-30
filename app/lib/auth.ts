// 이메일 없이 아이디로 가입하므로 Supabase Auth에는 가짜 이메일로 넣는다 (.invalid는 실제로 존재할 수 없는 도메인).
export function usernameToEmail(username: string): string {
  return `${username.toLowerCase()}@users.local.invalid`;
}
