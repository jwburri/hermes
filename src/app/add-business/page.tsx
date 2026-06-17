"use client";

import { useState } from "react";
import Link from "next/link";

export default function AddBusinessPage() {
  const [name, setName] = useState("");
  const [driveLink, setDriveLink] = useState("");
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");
  const [loading, setLoading] = useState(false);

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
      } else {
        setError(data.error || "Could not add the business.");
      }
    } catch {
      setError("Something went wrong. Try again.");
    } finally {
      setLoading(false);
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
          Use the buyer-safe folder only. No broker agreement, commission, private
          notes, or the seller&apos;s identity.
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
    </main>
  );
}
