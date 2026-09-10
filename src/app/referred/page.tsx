"use client";

import { useCallback, useEffect, useState } from "react";
import { Header } from "../components/Header";
import { Footer } from "../components/Footer";

interface Business {
  id: string;
  name: string;
}

interface ReferredQuestion {
  id: string;
  business: string;
  question: string;
  created: string;
}

export default function ReferredPage() {
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [businessFilter, setBusinessFilter] = useState("");

  const [questions, setQuestions] = useState<ReferredQuestion[] | null>(null);
  const [loadError, setLoadError] = useState("");

  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [savingId, setSavingId] = useState("");
  const [saveError, setSaveError] = useState<Record<string, string>>({});

  useEffect(() => {
    fetch("/api/businesses")
      .then((res) => res.json())
      .then((data) => setBusinesses(data.businesses || []))
      .catch(() => {});
  }, []);

  // Deliberately doesn't reset `questions` to null on refetch (only the
  // initial mount shows "Loading…"): a filter change just swaps the list in
  // place once the new one arrives, so no synchronous setState runs in the
  // effect body below.
  const loadQuestions = useCallback(() => {
    const url = businessFilter
      ? `/api/referred?business=${encodeURIComponent(businessFilter)}`
      : "/api/referred";
    fetch(url)
      .then((res) => res.json())
      .then((data) => {
        if (data.questions) {
          setQuestions(data.questions);
          setLoadError("");
        } else {
          setLoadError(data.error || "Could not load referred questions.");
        }
      })
      .catch(() => setLoadError("Could not load referred questions."));
  }, [businessFilter]);

  useEffect(() => {
    loadQuestions();
  }, [loadQuestions]);

  async function handleSave(q: ReferredQuestion) {
    const sellerAnswer = (drafts[q.id] ?? "").trim();
    if (!sellerAnswer) return;
    setSavingId(q.id);
    setSaveError((prev) => ({ ...prev, [q.id]: "" }));
    try {
      const res = await fetch(`/api/referred/${q.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sellerAnswer }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setQuestions((prev) => (prev ?? []).filter((r) => r.id !== q.id));
      } else {
        setSaveError((prev) => ({
          ...prev,
          [q.id]: data.error || "Could not save the answer.",
        }));
      }
    } catch {
      setSaveError((prev) => ({
        ...prev,
        [q.id]: "Something went wrong. Try again.",
      }));
    } finally {
      setSavingId("");
    }
  }

  return (
    <>
      <Header />
      <main className="flex-1 w-full max-w-[760px] mx-auto px-6 py-8">
        <h1 className="text-xl font-medium mb-4">Referred questions</h1>

        <div className="card mb-6">
          <label className="field-label" htmlFor="business-filter">
            Business
          </label>
          <select
            id="business-filter"
            value={businessFilter}
            onChange={(e) => setBusinessFilter(e.target.value)}
            className="input"
          >
            <option value="">All businesses</option>
            {businesses.map((b) => (
              <option key={b.id} value={b.name}>
                {b.name}
              </option>
            ))}
          </select>
        </div>

        {loadError && <p className="text-sm text-red-600 mb-4">{loadError}</p>}

        {questions === null && !loadError ? (
          <p className="text-sm" style={{ color: "var(--muted)" }}>
            Loading…
          </p>
        ) : questions && questions.length === 0 ? (
          <p className="text-sm" style={{ color: "var(--muted)" }}>
            No open questions.
          </p>
        ) : (
          <div className="flex flex-col gap-4">
            {questions?.map((q) => (
              <div key={q.id} className="card">
                <div className="flex items-center justify-between mb-2">
                  <span className="field-label" style={{ marginBottom: 0 }}>
                    {q.business}
                  </span>
                  <span className="text-xs" style={{ color: "var(--muted)" }}>
                    {q.created}
                  </span>
                </div>
                <p className="text-sm mb-3">{q.question}</p>

                <label className="field-label" htmlFor={`answer-${q.id}`}>
                  Seller&apos;s answer
                </label>
                <textarea
                  id={`answer-${q.id}`}
                  value={drafts[q.id] ?? ""}
                  onChange={(e) =>
                    setDrafts((prev) => ({ ...prev, [q.id]: e.target.value }))
                  }
                  rows={3}
                  className="input mb-3"
                  style={{ resize: "vertical" }}
                />

                {saveError[q.id] && (
                  <p className="text-sm text-red-600 mb-3">{saveError[q.id]}</p>
                )}

                <button
                  onClick={() => handleSave(q)}
                  disabled={savingId === q.id || !(drafts[q.id] ?? "").trim()}
                  className="btn-primary"
                >
                  {savingId === q.id && <span className="spinner" aria-hidden />}
                  {savingId === q.id ? "Saving…" : "Save"}
                </button>
              </div>
            ))}
          </div>
        )}
      </main>
      <Footer />
    </>
  );
}
