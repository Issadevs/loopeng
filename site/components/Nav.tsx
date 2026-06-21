"use client";

import { useEffect, useState } from "react";
import { useContent, REPO_URL, GITHUB_STARS_FALLBACK } from "@/lib/content";
import { useLocale } from "@/lib/i18n";

export default function Nav() {
  const { nav } = useContent();
  const { locale, setLocale } = useLocale();
  const [scrolled, setScrolled] = useState(false);
  const [stars, setStars] = useState<number>(GITHUB_STARS_FALLBACK);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch("https://api.github.com/repos/issadevs/loopeng");
        if (!res.ok) return;
        const data: unknown = await res.json();
        const count = (data as { stargazers_count?: unknown })?.stargazers_count;
        if (active && typeof count === "number" && Number.isFinite(count)) {
          setStars(count);
        }
      } catch { /* keep fallback */ }
    })();
    return () => { active = false; };
  }, []);

  return (
    <header
      className={`fixed inset-x-0 top-0 z-50 border-b transition-colors duration-300 ${
        scrolled
          ? "border-border bg-bg/80 backdrop-blur"
          : "border-transparent"
      }`}
    >
      <nav className="mx-auto flex h-14 max-w-5xl items-center justify-between gap-3 px-4">
        <a
          href="#top"
          className="flex items-center gap-2 font-mono text-amber transition-colors hover:text-amber-bright"
        >
          <span aria-hidden="true" className="text-sm">
            (◕◡◕)
          </span>
          <span className="text-sm font-medium">loopEng</span>
        </a>

        <ul className="hidden items-center gap-6 md:flex">
          {nav.map((link) => (
            <li key={link.href}>
              <a
                href={link.href}
                className="font-mono text-sm text-muted transition-colors hover:text-text"
              >
                {link.label}
              </a>
            </li>
          ))}
        </ul>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setLocale(locale === "fr" ? "en" : "fr")}
            className="rounded-full border border-border px-2.5 py-1 font-mono text-xs text-muted transition-colors hover:text-text"
          >
            {locale === "fr" ? "EN" : "FR"}
          </button>
          <a
            href={REPO_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 rounded-full border border-border px-3 py-1 font-mono text-xs text-muted transition-colors hover:text-text"
          >
            <span className="text-amber" aria-hidden="true">
              ★
            </span>
            <span>{stars.toLocaleString("en-US")}</span>
          </a>
          <a
            href="#install"
            className="rounded-full bg-amber px-3 py-1 font-mono text-xs font-medium text-bg transition-colors hover:bg-amber-bright"
          >
            {locale === "fr" ? "Installer" : "Install"}
          </a>
        </div>
      </nav>
    </header>
  );
}
