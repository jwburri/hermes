"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

interface Business {
  id: string;
  name: string;
}

export default function Home() {
  const router = useRouter();
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [businessId, setBusinessId] = useState("");
  const [questions, setQuestions] = useState("");
  const [answer, setAnswer] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    fetch("/api/businesses")
      .then((res) => res.json())
      .then((data) => {
        if (data.businesses) setBusinesses(data.businesses);
        else setLoadError(data.error || "Could not load businesses.");
      })
      .catch(() => setLoadError("Could not load businesses."));
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setAnswer("");
    setCopied(false);
    setLoading(true);
    try {
      const res = await fetch("/api/answer", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ businessId, questions }),
      });

      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || "Could not get answers.");
        setLoading(false);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let acc = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        acc += decoder.decode(value, { stream: true });
        setAnswer(acc);
      }
    } catch {
      setError("Something went wrong while getting answers.");
    } finally {
      setLoading(false);
    }
  }

  async function handleCopy() {
    await navigator.clipboard.writeText(answer);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function handleLogout() {
    await fetch("/api/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  return (
    <main className="flex-1 w-full max-w-3xl mx-auto p-6">
      <header className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold">Hermes</h1>
        <nav className="flex items-center gap-4 text-sm">
          <Link href="/add-business" className="text-gray-700 underline">
            Add business
          </Link>
          <button onClick={handleLogout} className="text-gray-500">
            Log out
          </button>
        </nav>
      </header>

      <form
        onSubmit={handleSubmit}
        className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 mb-6"
      >
        <label className="block text-sm font-medium mb-1" htmlFor="business">
          Business
        </label>
        <select
          id="business"
          value={businessId}
          onChange={(e) => setBusinessId(e.target.value)}
          className="w-full border border-gray-300 rounded-md px-3 py-2 mb-4 bg-white focus:outline-none focus:ring-2 focus:ring-gray-400"
        >
          <option value="">Select a business…</option>
          {businesses.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
        {loadError && <p className="text-sm text-red-600 mb-4">{loadError}</p>}

        <label className="block text-sm font-medium mb-1" htmlFor="questions">
          Paste the buyer&apos;s questions here
        </label>
        <textarea
          id="questions"
          value={questions}
          onChange={(e) => setQuestions(e.target.value)}
          rows={8}
          placeholder={"1. How much profit does the business make each month?\n2. Why is the seller selling?"}
          className="w-full border border-gray-300 rounded-md px-3 py-2 mb-4 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-gray-400"
        />

        <button
          type="submit"
          disabled={loading || !businessId || !questions.trim()}
          className="bg-gray-900 text-white rounded-md px-5 py-2 font-medium disabled:opacity-50"
        >
          {loading ? "Getting answers…" : "Get answers"}
        </button>
      </form>

      {error && <p className="text-sm text-red-600 mb-4">{error}</p>}

      {(answer || loading) && (
        <section className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-medium text-gray-500">Answer</h2>
            <button
              onClick={handleCopy}
              disabled={!answer}
              className="text-sm border border-gray-300 rounded-md px-3 py-1 disabled:opacity-50"
            >
              {copied ? "Copied" : "Copy answers"}
            </button>
          </div>
          <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed">
            {answer || "…"}
          </pre>
        </section>
      )}
    </main>
  );
}
