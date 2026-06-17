"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";

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
    <main className="flex-1 w-full max-w-2xl mx-auto p-6">
      <header className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold">Add a business</h1>
        <Link href="/" className="text-sm text-gray-700 underline">
          Back
        </Link>
      </header>

      <form
        onSubmit={handleSubmit}
        className="bg-white rounded-lg shadow-sm border border-gray-200 p-6"
      >
        <label className="block text-sm font-medium mb-1" htmlFor="name">
          Business name
        </label>
        <input
          id="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="PawsLoveStore.com"
          className="w-full border border-gray-300 rounded-md px-3 py-2 mb-4 focus:outline-none focus:ring-2 focus:ring-gray-400"
        />

        <label className="block text-sm font-medium mb-1" htmlFor="driveLink">
          Google Drive folder link
        </label>
        <input
          id="driveLink"
          value={driveLink}
          onChange={(e) => setDriveLink(e.target.value)}
          placeholder="https://drive.google.com/drive/folders/…"
          className="w-full border border-gray-300 rounded-md px-3 py-2 mb-2 focus:outline-none focus:ring-2 focus:ring-gray-400"
        />
        <p className="text-xs text-gray-500 mb-4">
          Point at that business&apos;s own folder. Broker agreements, commission,
          asset purchase agreements, outreach lists, and internal call notes are
          automatically excluded.
        </p>

        {error && <p className="text-sm text-red-600 mb-4">{error}</p>}
        {saved && <p className="text-sm text-green-700 mb-4">{saved}</p>}

        <button
          type="submit"
          disabled={loading || !name.trim() || !driveLink.trim()}
          className="bg-gray-900 text-white rounded-md px-5 py-2 font-medium disabled:opacity-50"
        >
          {loading ? "Saving…" : "Save"}
        </button>
      </form>

      <section className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 mt-6">
        <h2 className="text-sm font-medium text-gray-500 mb-3">
          Current businesses
        </h2>
        {businesses.length === 0 ? (
          <p className="text-sm text-gray-500">None yet.</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {businesses.map((b) => (
              <li
                key={b.id}
                className="flex items-center justify-between py-2"
              >
                <span className="text-sm">{b.name}</span>
                <button
                  onClick={() => handleArchive(b)}
                  disabled={archivingId === b.id}
                  className="text-sm text-red-600 border border-red-200 rounded-md px-3 py-1 disabled:opacity-50"
                >
                  {archivingId === b.id ? "Archiving…" : "Archive"}
                </button>
              </li>
            ))}
          </ul>
        )}
        <p className="text-xs text-gray-500 mt-3">
          Archiving removes a business from the dropdown so Hermes stops answering
          for it. Use it when a business sells.
        </p>
      </section>
    </main>
  );
}
