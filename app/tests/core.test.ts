import { afterAll, describe, expect, it } from "vitest";
import { usernameToEmail } from "../lib/auth";
import { admin, anon, createUser, sql, uniqueName } from "./helpers";

const db = sql();
afterAll(() => db.end());

describe("signup", () => {
  it("creates a profile with the signup bonus exactly once", async () => {
    const u = await createUser();
    const { data } = await u.client.from("profiles").select("username, balance, role").eq("id", u.id).single();
    expect(data).toEqual({ username: u.username, balance: 10000, role: "user" });
    const { data: rows } = await u.client.from("ledger").select("kind, delta, ref_id");
    expect(rows).toEqual([{ kind: "signup_bonus", delta: 10000, ref_id: "signup" }]);
  });

  it("rejects direct sign-ups with the public key", async () => {
    const { error } = await anon().auth.signUp({ email: usernameToEmail(uniqueName()), password: "whatever-123" });
    expect(error).not.toBeNull();
  });

  it("checks invite codes only with the service role", async () => {
    expect((await admin().rpc("verify_invite_code", { p_code: "totoro" })).data).toBe(true);
    expect((await admin().rpc("verify_invite_code", { p_code: "nope" })).data).toBe(false);
    const u = await createUser();
    expect((await u.client.rpc("verify_invite_code", { p_code: "totoro" })).error).not.toBeNull();
    expect((await anon().rpc("verify_invite_code", { p_code: "totoro" })).error).not.toBeNull();
  });
});

describe("client cannot move points", () => {
  it("cannot update balances or write the ledger", async () => {
    const u = await createUser();
    await u.client.from("profiles").update({ balance: 999999 }).eq("id", u.id);
    await u.client.from("ledger").insert({ user_id: u.id, delta: 5, kind: "payout", ref_id: "x", balance_after: 5 });
    const { data } = await u.client.from("profiles").select("balance").eq("id", u.id).single();
    expect(data!.balance).toBe(10000);
    const [{ count }] = await db`select count(*)::int as count from public.ledger where user_id = ${u.id}`;
    expect(count).toBe(1);
  });

  it("cannot reach private functions through the API", async () => {
    const u = await createUser();
    const { error } = await u.client.rpc("_apply_ledger", { p_user: u.id, p_delta: 1e9, p_kind: "payout", p_ref: "hack" });
    expect(error).not.toBeNull();
    const { error: e2 } = await u.client.schema("private" as "public").rpc("_apply_ledger", {
      p_user: u.id,
      p_delta: 1e9,
      p_kind: "payout",
      p_ref: "hack",
    });
    expect(e2).not.toBeNull();
  });

  it("only reads its own ledger", async () => {
    const a = await createUser();
    const b = await createUser();
    const { data } = await a.client.from("ledger").select("user_id");
    expect(data!.every((r) => r.user_id === a.id)).toBe(true);
    expect(data!.some((r) => r.user_id === b.id)).toBe(false);
  });
});

describe("function privileges (catalog audit)", () => {
  it("exposes no public function to anon and only SECURITY DEFINER wrappers to authenticated", async () => {
    const rows = await db`
      select p.proname, p.prosecdef,
             has_function_privilege('anon', p.oid, 'execute') as anon_exec,
             has_function_privilege('authenticated', p.oid, 'execute') as auth_exec
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'`;
    expect(rows.filter((r) => r.anon_exec).map((r) => r.proname)).toEqual([]);
    expect(rows.filter((r) => r.auth_exec && !r.prosecdef).map((r) => r.proname)).toEqual([]);
  });

  it("grants no EXECUTE on private functions to PUBLIC, anon or authenticated", async () => {
    const rows = await db`
      select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'private'
        and (p.proacl is null
             or has_function_privilege('anon', p.oid, 'execute')
             or has_function_privilege('authenticated', p.oid, 'execute'))`;
    expect(rows.map((r) => r.proname)).toEqual([]);
  });

  it("leaves API roles only SELECT on app tables", async () => {
    const rows = await db`
      select table_name, grantee, privilege_type from information_schema.role_table_grants
      where table_schema = 'public' and grantee in ('anon', 'authenticated') and privilege_type <> 'SELECT'`;
    expect(rows).toEqual([]);
  });

  it("keeps the private schema closed to API roles", async () => {
    const [row] = await db`
      select has_schema_privilege('anon', 'private', 'usage') as anon_usage,
             has_schema_privilege('authenticated', 'private', 'usage') as auth_usage`;
    expect(row).toEqual({ anon_usage: false, auth_usage: false });
  });
});

describe("daily claims", () => {
  it("pays attendance once per KST day, even under concurrent requests", async () => {
    const u = await createUser();
    const results = await Promise.all(Array.from({ length: 5 }, () => u.client.rpc("claim_attendance")));
    expect(results.filter((r) => !r.error)).toHaveLength(1);
    const { data } = await u.client.from("profiles").select("balance").eq("id", u.id).single();
    expect(data!.balance).toBe(10500);
  });

  it("pays the rescue only below the threshold", async () => {
    const u = await createUser();
    expect((await u.client.rpc("claim_rescue")).error).not.toBeNull();
    await db`update public.profiles set balance = 50 where id = ${u.id}`;
    const r = await u.client.rpc("claim_rescue");
    expect(r.error).toBeNull();
    expect(r.data).toBe(1050);
    expect((await u.client.rpc("claim_rescue")).error).not.toBeNull();
  });

  it("requires a signed-in user", async () => {
    expect((await anon().rpc("claim_attendance")).error).not.toBeNull();
  });
});

describe("signup rate limit", () => {
  it("allows 5 attempts per IP per hour, then refuses", async () => {
    const ip = `test-${Date.now()}`;
    const results: boolean[] = [];
    for (let i = 0; i < 6; i++) results.push((await admin().rpc("signup_rate_ok", { p_ip: ip })).data);
    expect(results).toEqual([true, true, true, true, true, false]);
    expect((await anon().rpc("signup_rate_ok", { p_ip: ip })).error).not.toBeNull();
  });
});
