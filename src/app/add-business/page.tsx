"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { Header } from "../components/Header";
import { Footer } from "../components/Footer";

interface Business {
  id: string;
  name: string;
}

export default function AddBusinessPage() {
  const [name, setName] = useState("");
  const [driveLink, setDriveLink] = useState("");
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");
  const [loading, setLoading] = useState(false);

  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [archivingId, setArchivingId] = useState("");

  const loadBusinesses = useCallback(() => {
    fetch("/api/businesses")
      .then((res) => res.json())
      .then((data) => setBusinesses(data.businesses || []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    loadBusinesses();
  }, [loadBusinesses]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSaved("");
    setLoading(true);
    try {
      const res = await fetch("/api/businesses", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, driveLink }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setSaved(`Added "${data.name}". It will appear in the dropdown.`);
        setName("");
        setDriveLink("");
        loadBusinesses();
      } else {
        setError(data.error || "Could not add the business.");
      }
    } catch {
      setError("Something went wrong. Try again.");
    } finally {
      setLoading(false);
    }
  }

  async function handleArchive(b: Business) {
    if (
      !confirm(
        `Archive "${b.name}"? It will be removed from the dropdown and Hermes will stop answering for it. You can re-add it later.`,
      )
    )
      return;
    setArchivingId(b.id);
    try {
      const res = await fetch("/api/businesses/archive", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: b.id }),
      });
      if (res.ok) loadBusinesses();
    } finally {
      setArchivingId("");
    }
  }

  return (
    <>
      <Header />
      <main className="flex-1 w-full max-w-[760px] mx-auto px-6 py-8">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-xl font-medium">Add a business</h1>
          <Link href="/" className="text-sm underline" style={{ color: "var(--muted)" }}>
            Back
          </Link>
        </div>

        <form onSubmit={handleSubmit} className="card">
          <label className="field-label" htmlFor="name">
            Business name
          </label>
          <input
            id="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="PawsLoveStore.com"
            className="input mb-4"
          />

          <label className="field-label" htmlFor="driveLink">
            Google Drive folder link
          </label>
          <input
            id="driveLink"
            value={driveLink}
            onChange={(e) => setDriveLink(e.target.value)}
            placeholder="https://drive.google.com/drive/folders/…"
            className="input mb-2"
          />
          <p className="text-xs mb-4" style={{ color: "var(--muted)" }}>
            Point at that business&apos;s own folder. Broker agreements,
            commission, asset purchase agreements, outreach lists, and internal
            call notes are automatically excluded.
          </p>

          {error && <p className="text-sm text-red-600 mb-4">{error}</p>}
          {saved && <p className="text-sm text-green-700 mb-4">{saved}</p>}

          <button
            type="submit"
            disabled={loading || !name.trim() || !driveLink.trim()}
            className="btn-primary"
          >
            {loading ? "Saving…" : "Save"}
          </button>
        </form>

        <section className="card mt-6">
          <span className="field-label">Current businesses</span>
          {businesses.length === 0 ? (
            <p className="text-sm" style={{ color: "var(--muted)" }}>
              None yet.
            </p>
          ) : (
            <ul className="divide-y" style={{ borderColor: "var(--card-border)" }}>
              {businesses.map((b) => (
                <li key={b.id} className="flex items-center justify-between py-2">
                  <span className="text-sm">{b.name}</span>
                  <button
                    onClick={() => handleArchive(b)}
                    disabled={archivingId === b.id}
                    className="btn-outline"
                    style={{ color: "#b3489a", borderColor: "#e7cfe1" }}
                  >
                    {archivingId === b.id ? "Archiving…" : "Archive"}
                  </button>
                </li>
              ))}
            </ul>
          )}
          <p className="text-xs mt-3" style={{ color: "var(--muted)" }}>
            Archiving removes a business from the dropdown so Hermes stops
            answering for it. Use it when a business sells.
          </p>
        </section>
      </main>
      <Footer />
    </>
  );
}
