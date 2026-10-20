import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

export function PublicPage({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="min-h-screen bg-background">
      <header className="mx-auto flex max-w-4xl items-center justify-between px-6 py-6">
        <Link to="/" className="member-brand font-display text-lg font-semibold">
          <img src="/icon-192.png" width={28} height={28} alt="" />
          <span>
            Plex<span className="text-execute">ecute</span>
          </span>
        </Link>
        <nav className="flex flex-wrap justify-end gap-3 text-xs text-muted-foreground">
          <Link to="/how-it-works" className="hover:text-foreground">
            How it works
          </Link>
          <Link to="/pricing" className="hover:text-foreground">
            Pricing
          </Link>
          <Link to="/login" className="hover:text-foreground">
            Log in
          </Link>
        </nav>
      </header>
      <main className="mx-auto max-w-4xl px-6 pb-20">
        <h1 className="mt-10 text-4xl font-semibold md:text-5xl">{title}</h1>
        <div className="mt-8 space-y-4 text-muted-foreground [&_h2]:mt-8 [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:text-foreground">
          {children}
        </div>
      </main>
      <footer className="mx-auto flex max-w-4xl flex-wrap gap-4 border-t border-border px-6 py-8 text-xs text-muted-foreground">
        <Link to="/privacy">Privacy</Link>
        <Link to="/terms">Terms</Link>
        <Link to="/legal/$doc" params={{ doc: "cookies" }}>
          Cookies
        </Link>
        <Link to="/legal/$doc" params={{ doc: "accessibility" }}>
          Accessibility
        </Link>
        <Link to="/safety">Safety</Link>
        <Link to="/legal">All legal</Link>
        <span className="ml-auto">18+ only · Not medical advice</span>
      </footer>
    </div>
  );
}
