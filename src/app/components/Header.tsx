"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";

export function Header({ showNav = true }: { showNav?: boolean }) {
  const router = useRouter();

  async function logout() {
    await fetch("/api/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  return (
    <>
      <header className="app-header">
        <div className="w-full max-w-[760px] mx-auto flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <span className="brand-mark" aria-hidden />
            <span className="text-white" style={{ fontSize: 18, fontWeight: 500 }}>
              Hermes
            </span>
            <span className="header-divider" aria-hidden />
            <span style={{ fontSize: 12, color: "var(--header-subtitle)" }}>
              Just Website Brokerage
            </span>
          </div>
          {showNav && (
            <nav className="flex items-center gap-4">
              <Link href="/add-business" className="header-link">
                Add business
              </Link>
              <button onClick={logout} className="header-link">
                Log out
              </button>
            </nav>
          )}
        </div>
      </header>
      <div className="brand-strip" aria-hidden />
    </>
  );
}
