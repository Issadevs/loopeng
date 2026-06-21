"use client";

import SectionLabel from "@/components/SectionLabel";
import { useContent } from "@/lib/content";

export default function Operate() {
  const { operate, sectionLabels } = useContent();

  return (
    <section id="operate" className="mx-auto w-full max-w-6xl px-6 py-20 sm:py-24">
      <SectionLabel>{sectionLabels.operate}</SectionLabel>

      <div className="mt-6 max-w-3xl">
        <h2 className="font-serif text-4xl leading-tight text-text sm:text-5xl">
          {operate.heading}
        </h2>
        <p className="mt-4 text-sm leading-relaxed text-muted sm:text-base">
          {operate.sub}
        </p>
      </div>

      <div className="mt-10 grid gap-4 lg:grid-cols-3">
        {operate.cards.map((card) => (
          <article key={card.title} className="rounded-lg border border-border bg-raised px-5 py-5 transition-colors hover:border-border-bright">
            <p className="font-mono text-xs uppercase tracking-[0.16em] text-dim">
              {card.title}
            </p>
            <code className="mt-4 block overflow-x-auto whitespace-nowrap font-mono text-sm text-green">
              {card.command}
            </code>
            <p className="mt-4 text-sm leading-relaxed text-muted">{card.body}</p>
            <ul className="mt-5 space-y-2 border-t border-border pt-4">
              {card.bullets.map((bullet) => (
                <li key={bullet} className="flex gap-2 text-sm text-muted">
                  <span aria-hidden="true" className="text-amber">
                    ▸
                  </span>
                  <span>{bullet}</span>
                </li>
              ))}
            </ul>
          </article>
        ))}
      </div>
    </section>
  );
}
