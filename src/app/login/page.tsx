"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Header } from "../components/Header";

export default function LoginPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (res.ok) {
        router.push("/");
        router.refresh();
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data.error || "Login failed.");
      }
    } catch {
      setError("Something went wrong. Try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <Header showNav={false} />
      <main className="flex-1 flex items-center justify-center p-6">
        <form onSubmit={handleSubmit} className="card w-full max-w-sm">
          <h1 className="text-xl font-medium mb-1">Team login</h1>
          <p className="text-sm mb-6" style={{ color: "var(--muted)" }}>
            Sign in to answer buyer questions.
          </p>

          <label className="field-label" htmlFor="password">
            Password
          </label>
          <input
            id="password"
            type="password"
            autoFocus
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="input mb-4"
          />

          {error && <p className="text-sm text-red-600 mb-4">{error}</p>}

          <button
            type="submit"
            disabled={loading || !password}
            className="btn-primary w-full justify-center"
          >
            {loading && <span className="spinner" aria-hidden />}
            {loading ? "Checking…" : "Log in"}
          </button>
        </form>
      </main>
    </>
  );
}
