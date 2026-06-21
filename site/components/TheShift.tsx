"use client";

import type { ReactNode } from "react";
import SectionLabel from "@/components/SectionLabel";
import { useContent } from "@/lib/content";

function emphasizePossessive(text: string): ReactNode[] {
  return text.split(/(\byour\b|\bvotre\b|\bvos\b)/i).map((part, i) =>
    /^(your|votre|vos)$/i.test(part) ? (
      <em key={i} className="not-italic text-text">{part}</em>
    ) : (
      <span key={i}>{part}</span>
    ),
  );
}

export default function TheShift() {
  const { shift: shiftContent, sectionLabels } = useContent();
  const [featured, ...rest] = shiftContent.quotes;

  return (
    <section id="shift" className="mx-auto w-full max-w-5xl px-6 py-24 sm:py-32">
      <SectionLabel>{sectionLabels.shift}</SectionLabel>

      <h2 className="mt-6 max-w-3xl font-serif text-4xl leading-tight text-text sm:text-5xl">
        {shiftContent.heading}
      </h2>

      <div className="mt-14 flex flex-col gap-10">
        {/* Featured quote — Anthropic callout */}
        {featured && (
          <div className="relative border border-amber/30 bg-raised px-8 py-8 sm:px-10">
            {/* amber top accent line */}
            <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-amber to-transparent" />
            {/* decorative opening quote mark */}
            <span
              aria-hidden="true"
              className="pointer-events-none absolute -top-4 left-6 select-none font-serif text-6xl leading-none text-amber/40"
            >
              &ldquo;
            </span>

            <blockquote className="flex flex-col gap-5">
              <p className="font-serif text-2xl italic leading-relaxed text-text sm:text-3xl">
                {featured.text}
              </p>
              <footer className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-sm text-amber">— {featured.author}</span>
                {featured.role && (
                  <span className="rounded-full border border-amber/30 bg-amber/5 px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.15em] text-amber/70">
                    {featured.role}
                  </span>
                )}
              </footer>
            </blockquote>
          </div>
        )}

        {/* Secondary quotes */}
        {rest.map((quote) => (
          <blockquote key={quote.author} className="flex flex-col gap-4 border-l-2 border-border-bright pl-6">
            <p className="font-serif text-xl italic leading-relaxed text-muted sm:text-2xl">
              {quote.text}
            </p>
            <footer className="font-mono text-sm text-dim">
              — {quote.author}
              {quote.role ? <span className="opacity-60"> · {quote.role}</span> : null}
            </footer>
          </blockquote>
        ))}
      </div>

      <p className="mt-16 max-w-3xl font-mono text-base leading-relaxed text-muted">
        {emphasizePossessive(shiftContent.closing)}
      </p>
    </section>
  );
}
