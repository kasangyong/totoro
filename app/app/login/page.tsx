"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { usernameToEmail } from "@/lib/auth";
import { supabaseBrowser } from "@/lib/supabase/browser";

type Mode = "login" | "signup";

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === "signup") {
        const res = await fetch("/api/signup", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ username, password, inviteCode }),
        });
        if (!res.ok) {
          const body: { error?: string } = await res.json().catch(() => ({}));
          setError(body.error ?? "가입하지 못했어요.");
          return;
        }
      }
      const { error: signInError } = await supabaseBrowser().auth.signInWithPassword({
        email: usernameToEmail(username),
        password,
      });
      if (signInError) {
        setError("아이디 또는 비밀번호가 맞지 않아요.");
        return;
      }
      router.replace("/");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-6 px-4 py-10">
      <h1 className="text-center font-logo text-5xl leading-tight text-accent drop-shadow">
        배팅 <span className="text-fg/70">♠</span> 할래
        <br />
        <span className="text-fg/70">♦</span> 말래
      </h1>
      <p className="text-center text-sm text-muted">우리끼리 가상 포인트로 즐기는 게임장 · 실제 돈은 쓰지 않아요</p>

      <form onSubmit={submit} className="panel flex flex-col gap-3 p-5">
        <div className="mb-1 grid grid-cols-2 gap-2" role="tablist">
          {(["login", "signup"] as const).map((m) => (
            <button
              key={m}
              type="button"
              role="tab"
              aria-selected={mode === m}
              onClick={() => {
                setMode(m);
                setError(null);
              }}
              className={`rounded-lg py-2 text-sm font-bold ${mode === m ? "bg-accent/15 text-accent" : "text-muted"}`}
            >
              {m === "login" ? "로그인" : "가입"}
            </button>
          ))}
        </div>

        <label className="flex flex-col gap-1 text-sm">
          아이디
          <input
            className="field"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            placeholder="영문 소문자·숫자 3~16자"
            required
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          비밀번호
          <input
            className="field"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={mode === "login" ? "current-password" : "new-password"}
            minLength={6}
            required
          />
        </label>
        {mode === "signup" && (
          <label className="flex flex-col gap-1 text-sm">
            초대코드
            <input className="field" value={inviteCode} onChange={(e) => setInviteCode(e.target.value)} required />
          </label>
        )}

        {error && (
          <p role="alert" className="text-sm text-bust">
            {error}
          </p>
        )}

        <button type="submit" className="btn-main mt-2 py-3 text-lg" disabled={busy}>
          {busy ? "잠시만요…" : mode === "login" ? "들어가기" : "가입하고 10,000P 받기"}
        </button>
      </form>
    </main>
  );
}
