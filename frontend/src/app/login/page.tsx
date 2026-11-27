"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { fetchCurrentUser, loginUser } from "@/lib/api";

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState<string>("");
  const [password, setPassword] = useState<string>("");
  const [showPassword, setShowPassword] = useState<boolean>(false);
  const [error, setError] = useState<string>("");
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [clockText, setClockText] = useState<string>("--:--:--");

  useEffect(() => {
    const tick = () => setClockText(new Date().toLocaleTimeString("en-IN", { hour12: false }));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const u = await fetchCurrentUser();
        if (alive && u) {
          router.replace("/");
        }
      } catch {
        // Stay on login page
      }
    })();
    return () => {
      alive = false;
    };
  }, [router]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!username.trim() || !password) {
      setError("Please enter both your username and password.");
      return;
    }
    setSubmitting(true);
    try {
      await loginUser(username.trim(), password);
      router.replace("/");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Invalid username or password.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen flex flex-col bg-[#f1f5f9] text-[#0f172a]">
      <header className="ifb-header">
        <div className="flex items-center gap-3.5">
          <div className="ifb-logo">IFB</div>
          <div>
            <h1 className="text-lg font-bold leading-tight">IFB Manufacturing Solutions</h1>
            <p className="text-xs text-slate-300">Real-Time Production, Delivery Schedule &amp; Performance Portal</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1 text-xs font-medium">
            <span className="h-2 w-2 rounded-full bg-sky-400" />
            Sign In Required
          </span>
          <span className="rounded bg-black/25 px-3 py-1 font-mono text-xs text-slate-200">{clockText}</span>
        </div>
      </header>

      <main className="flex flex-1 items-center justify-center p-6">
        <div className="w-full max-w-md rounded-2xl border border-slate-200 border-t-4 border-t-[#123b63] bg-white p-7 shadow-lg">
          <span className="inline-block rounded-full border border-blue-200 bg-blue-50 px-3 py-0.5 text-[11px] font-bold uppercase tracking-wider text-[#123b63]">
            Authorized Access
          </span>
          <h2 className="mt-2.5 text-2xl font-extrabold">Portal Sign In</h2>
          <p className="mt-1 text-sm text-slate-500">
            Enter your credentials to access production schedules, analytics, and dispatch reports.
          </p>

          {error && (
            <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs font-semibold text-red-700">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="mt-5 space-y-4">
            <div>
              <label htmlFor="loginUsername" className="block text-xs font-semibold text-slate-700 mb-1.5">
                Username
              </label>
              <input
                id="loginUsername"
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Enter username"
                autoComplete="username"
                required
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm transition focus:border-[#123b63] focus:ring-2 focus:ring-[#123b63]/15 focus:outline-none"
              />
            </div>

            <div>
              <label htmlFor="loginPassword" className="block text-xs font-semibold text-slate-700 mb-1.5">
                Password
              </label>
              <div className="relative flex items-center">
                <input
                  id="loginPassword"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter password"
                  autoComplete="current-password"
                  required
                  className="w-full rounded-lg border border-slate-300 py-2 pr-14 pl-3 text-sm transition focus:border-[#123b63] focus:ring-2 focus:ring-[#123b63]/15 focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((prev) => !prev)}
                  className="absolute right-2.5 text-xs font-semibold text-slate-500 hover:text-slate-800"
                >
                  {showPassword ? "Hide" : "Show"}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="w-full rounded-lg bg-[#123b63] py-2.5 text-sm font-bold text-white hover:bg-[#0c2844] disabled:opacity-60"
            >
              {submitting ? "Signing in..." : "Sign In to Portal"}
            </button>
          </form>
        </div>
      </main>
    </div>
  );
}