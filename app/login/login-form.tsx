"use client";

import { LockKeyhole, Wifi } from "lucide-react";
import Image from "next/image";
import { FormEvent, useState } from "react";

export function LoginForm({ configured }: { configured: boolean }) {
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: form.get("username"),
          password: form.get("password"),
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Sign in failed");
      window.location.assign("/");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Sign in failed");
      setSubmitting(false);
    }
  }

  return (
    <main className="login-page">
      <section className="login-card">
        <div className="login-brand">
          <span><Image src="/homescope-icon.png?v=3" alt="" width={45} height={45} priority unoptimized /></span>
          <div><strong>HomeScope</strong><small>Private network monitor</small></div>
        </div>
        <div className="login-heading">
          <span><LockKeyhole size={22} /></span>
          <h1>Welcome back</h1>
          <p>Sign in to view the HomeScope dashboard stored on this Mac.</p>
        </div>
        {configured ? (
          <form onSubmit={submit}>
            <label>
              <span>Username</span>
              <input name="username" type="text" autoComplete="username" autoCapitalize="none" spellCheck={false} required />
            </label>
            <label>
              <span>Password</span>
              <input name="password" type="password" autoComplete="current-password" required />
            </label>
            {error ? <p className="login-error">{error}</p> : null}
            <button className="login-submit" disabled={submitting}>
              {submitting ? "Signing in…" : "Sign in"}
            </button>
          </form>
        ) : (
          <div className="login-setup">
            <Wifi size={20} />
            <div><strong>Local login is not configured</strong><p>Add the protected login values to this Mac before signing in.</p></div>
          </div>
        )}
        <footer><LockKeyhole size={14} /> Local encrypted session · This Mac only</footer>
      </section>
    </main>
  );
}
