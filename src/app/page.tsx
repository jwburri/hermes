"use client";

import { useEffect, useState } from "react";
import { Header } from "./components/Header";
import { Footer } from "./components/Footer";

interface Business {
  id: string;
  name: string;
}

interface Coverage {
  filesRead: { name: string; modified: string }[];
  filesSkipped: { name: string; reason: string }[];
  truncated: boolean;
}

export default function Home() {
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [businessId, setBusinessId] = useState("");
  const [questions, setQuestions] = useState("");
  const [answer, setAnswer] = useState("");
  const [coverage, setCoverage] = useState<Coverage | null>(null);
  const [stopReason, setStopReason] = useState("");
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
    setCoverage(null);
    setStopReason("");
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
      let buffer = "";
      let acc = "";
      const handle = (line: string) => {
        if (!line.trim()) return;
        let event;
        try {
          event = JSON.parse(line);
        } catch {
          return;
        }
        if (event.type === "text") {
          acc += event.delta;
          setAnswer(acc);
        } else if (event.type === "coverage") {
          setCoverage(event);
        } else if (event.type === "done") {
          setStopReason(event.stopReason ?? "");
        }
      };
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        // The last piece may be a partial line; keep it for the next chunk.
        buffer = lines.pop() ?? "";
        lines.forEach(handle);
      }
      // Flush any bytes the decoder is holding and the final unterminated line.
      handle(buffer + decoder.decode());
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

  const canSubmit = !loading && !!businessId && questions.trim().length > 0;

  return (
    <>
      <Header />
      <main className="flex-1 w-full max-w-[760px] mx-auto px-6 py-8">
        <form onSubmit={handleSubmit} className="card mb-6">
          <label className="field-label" htmlFor="business">
            Business
          </label>
          <select
            id="business"
            value={businessId}
            onChange={(e) => setBusinessId(e.target.value)}
            className="input mb-4"
          >
            <option value="">Select a business…</option>
            {businesses.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
          {loadError && (
            <p className="text-sm text-red-600 mb-4">{loadError}</p>
          )}

          <label className="field-label" htmlFor="questions">
            Paste the buyer&apos;s questions here
          </label>
          <textarea
            id="questions"
            value={questions}
            onChange={(e) => setQuestions(e.target.value)}
            rows={8}
            placeholder={"1. How much profit does the business make each month?\n2. Why is the seller selling?"}
            className="input mb-4"
            style={{ resize: "vertical" }}
          />

          <button type="submit" disabled={!canSubmit} className="btn-primary">
            {loading && <span className="spinner" aria-hidden />}
            {loading ? "Answering…" : "Get answers"}
          </button>
        </form>

        {error && <p className="text-sm text-red-600 mb-4">{error}</p>}

        {(answer || loading || stopReason) && (
          <section className="card">
            <div className="flex items-center justify-between mb-3">
              <span className="field-label" style={{ marginBottom: 0 }}>
                Answer
              </span>
              <button
                onClick={handleCopy}
                disabled={!answer}
                className="btn-outline"
              >
                {copied ? "Copied" : "Copy answers"}
              </button>
            </div>

            {stopReason === "max_tokens" && (
              <p className="text-sm text-red-600 mb-3">
                This answer was cut off by the length limit. Ask fewer questions
                at once.
              </p>
            )}

            {stopReason === "error" && (
              <p className="text-sm text-red-600 mb-3">
                The answer stopped early because of an error.
              </p>
            )}

            <div className="answer-text">
              {stopReason === "refusal"
                ? "Hermes could not answer this request."
                : answer || "…"}
            </div>

            {coverage && (
              <details className="mt-5 text-[13px]" style={{ color: "var(--muted)" }}>
                <summary className="cursor-pointer">
                  Documents Hermes read ({coverage.filesRead.length})
                </summary>
                <ul className="mt-2 space-y-1">
                  {coverage.filesRead.map((f, i) => (
                    <li key={`${i}-${f.name}`}>
                      {f.name} (last modified {f.modified})
                    </li>
                  ))}
                </ul>
                {coverage.filesSkipped.length > 0 && (
                  <>
                    <p className="mt-3">
                      Not read ({coverage.filesSkipped.length})
                    </p>
                    <ul className="mt-2 space-y-1">
                      {coverage.filesSkipped.map((f, i) => (
                        <li key={`${i}-${f.name}`}>
                          {f.name} — {f.reason}
                        </li>
                      ))}
                    </ul>
                  </>
                )}
                {coverage.truncated && (
                  <p className="mt-3">
                    Some documents were cut short by the size limit.
                  </p>
                )}
              </details>
            )}
          </section>
        )}
      </main>
      <Footer />
    </>
  );
}
