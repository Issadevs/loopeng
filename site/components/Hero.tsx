"use client";

import Image from "next/image";
import { useEffect, useState, type CSSProperties } from "react";
import Critter from "@/components/Critter";
import LoopEngField from "@/components/LoopEngField";
import TerminalCard from "@/components/TerminalCard";
import CopyButton from "@/components/CopyButton";
import { useContent, INSTALL_CMD, SETUP_CMD, REPO_URL } from "@/lib/content";
import { useLocale } from "@/lib/i18n";

// Page-load reveal + proposal slide-in keyframes. Kept inline so this
// component is self-contained. Under prefers-reduced-motion the global CSS
// rule in globals.css forces animation-duration ~0 with fill "both", so each
// element lands instantly at its final (visible) state — no transforms.
const KEYFRAMES = `
@keyframes loopeng-rise {
  from { opacity: 0; transform: translateY(12px); }
  to   { opacity: 1; transform: none; }
}
@keyframes loopeng-slide {
  from { opacity: 0; transform: translateY(6px); }
  to   { opacity: 1; transform: none; }
}`;

// Staggered reveal style for a given delay (seconds).
function reveal(delay: number): CSSProperties {
  return {
    animationName: "loopeng-rise",
    animationDuration: "0.6s",
    animationTimingFunction: "ease-out",
    animationFillMode: "both",
    animationDelay: `${delay}s`,
  };
}

const SLIDE_IN: CSSProperties = {
  animationName: "loopeng-slide",
  animationDuration: "0.4s",
  animationTimingFunction: "ease-out",
  animationFillMode: "both",
};

export default function Hero() {
  const { hero, readDocs, copyLabel, copiedLabel } = useContent();
  const { locale } = useLocale();
  const [showProposal, setShowProposal] = useState(false);

  useEffect(() => {
    const reduce =
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const t = setTimeout(() => setShowProposal(true), reduce ? 0 : 1600);
    return () => clearTimeout(t);
  }, []);

  // Split line2 at the em-dash so the leading phrase ("all quiet") can be
  // tinted blue and the remainder muted — derived entirely from content.
  const dashIdx = hero.demo.line2.indexOf(" — ");
  const line2Blue =
    dashIdx >= 0 ? hero.demo.line2.slice(0, dashIdx) : hero.demo.line2;
  const line2Rest = dashIdx >= 0 ? hero.demo.line2.slice(dashIdx) : "";

  return (
    <section id="top" className="relative isolate overflow-hidden">
      <LoopEngField />

      <div className="relative z-10 mx-auto flex max-w-6xl flex-col px-4 pt-28 pb-16 text-center sm:pt-32 sm:pb-20">
        <style>{KEYFRAMES}</style>

        <span
          style={reveal(0)}
          className="mx-auto inline-flex items-center gap-2 rounded-full border border-border px-3 py-1 font-mono text-xs text-muted"
        >
          <span
            aria-hidden="true"
            className="h-1.5 w-1.5 rounded-full bg-amber"
          />
          {hero.versionBadge}
        </span>

        <h1
          style={{
            ...reveal(0.08),
            fontSize: "clamp(2.75rem, 6vw, 4.75rem)",
          }}
          className="mx-auto mt-6 max-w-5xl font-serif leading-[1.02] tracking-tight text-text"
        >
          {hero.h1}
        </h1>

        <p
          style={{ ...reveal(0.16), maxWidth: "64ch" }}
          className="mx-auto mt-5 text-sm text-muted sm:text-base"
        >
          {hero.subcopy}
        </p>

        <ul
          style={reveal(0.24)}
          className="mx-auto mt-8 grid w-full max-w-5xl gap-3 text-left sm:grid-cols-3"
        >
          {hero.stats.map((stat) => (
            <li key={stat.label} className="border border-border bg-raised px-4 py-3">
              <p className="font-mono text-xs uppercase tracking-[0.16em] text-amber">
                {stat.value}
              </p>
              <p className="mt-2 text-sm leading-relaxed text-muted">{stat.label}</p>
            </li>
          ))}
        </ul>

        <div
          style={reveal(0.32)}
          className="mx-auto mt-8 grid w-full max-w-4xl gap-3 text-left sm:grid-cols-2"
        >
          {[
            {
              label: locale === "fr" ? "installer" : "install",
              command: INSTALL_CMD,
            },
            {
              label: locale === "fr" ? "configurer" : "setup",
              command: SETUP_CMD,
            },
          ].map((item) => (
            <div key={item.label} className="border border-border bg-inset px-4 py-3">
              <p className="font-mono text-xs uppercase tracking-[0.16em] text-dim">
                {item.label}
              </p>
              <div className="mt-3 flex items-center gap-3">
                <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap font-mono text-sm text-text">
                  {item.command}
                </code>
                <CopyButton
                  value={item.command}
                  label={copyLabel}
                  copiedLabel={copiedLabel}
                  className="shrink-0"
                />
              </div>
            </div>
          ))}
        </div>

        <div
          style={reveal(0.36)}
          className="mx-auto mt-4 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-sm text-muted"
        >
          <a
            href={hero.docsHref}
            target="_blank"
            rel="noopener noreferrer"
            className="transition-colors hover:text-amber"
          >
            {readDocs}
          </a>
          <a
            href={REPO_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="transition-colors hover:text-amber"
          >
            GitHub
          </a>
        </div>

        <div style={reveal(0.44)} className="mt-12 w-full">
          <div className="overflow-hidden border border-border bg-raised p-2 sm:p-3">
            <Image
              src="/dashboard.png"
              width={1676}
              height={672}
              alt="loopEng dashboard showing inbox, installed loops, and background activity"
              className="h-auto w-full"
              priority
            />
          </div>
          <div className="mx-auto mt-4 max-w-3xl">
            <TerminalCard title="live" className="text-left">
              <div className="flex items-start gap-4">
                <div className="shrink-0">
                  <Critter mood={showProposal ? "perky" : "idle"} animate />
                </div>
                <div className="min-w-0 flex-1 space-y-1.5">
                  <p className="text-muted">{hero.demo.line1}</p>
                  <p>
                    <span className="text-blue">{line2Blue}</span>
                    {line2Rest ? (
                      <span className="text-muted">{line2Rest}</span>
                    ) : null}
                  </p>
                  {showProposal ? (
                    <p style={SLIDE_IN} className="text-green">
                      {hero.demo.proposal}
                    </p>
                  ) : null}
                </div>
              </div>
            </TerminalCard>
          </div>
        </div>
      </div>
    </section>
  );
}
