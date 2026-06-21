"use client";

import CopyButton from "@/components/CopyButton";
import SectionLabel from "@/components/SectionLabel";
import { useContent } from "@/lib/content";
import { useLocale } from "@/lib/i18n";

export default function InstallFlow() {
  const { installFlow, sectionLabels, copyLabel, copiedLabel } = useContent();
  const { locale } = useLocale();

  return (
    <section id="install" className="mx-auto w-full max-w-6xl px-6 py-20 sm:py-24">
      <SectionLabel>{sectionLabels.install}</SectionLabel>

      <div className="mt-6 grid gap-8 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] lg:items-start">
        <div>
          <h2 className="max-w-3xl font-serif text-4xl leading-tight text-text sm:text-5xl">
            {installFlow.heading}
          </h2>
          <p className="mt-4 max-w-2xl text-sm leading-relaxed text-muted sm:text-base">
            {installFlow.sub}
          </p>

          <div className="mt-10 space-y-5">
            {installFlow.steps.map((step, index) => (
              <div
                key={step.title}
                className="border-t border-border pt-5 first:border-t-0 first:pt-0"
              >
                <div className="flex items-baseline gap-3">
                  <span className="font-mono text-xs text-dim">
                    0{index + 1}
                  </span>
                  <h3 className="font-serif text-2xl text-text">{step.title}</h3>
                </div>
                <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted">
                  {step.body}
                </p>
                <div className="mt-4 flex items-center gap-3 rounded-lg border border-border bg-inset px-4 py-3">
                  <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap font-mono text-sm text-text">
                    {step.command}
                  </code>
                  <CopyButton
                    value={step.command}
                    label={copyLabel}
                    copiedLabel={copiedLabel}
                    className="shrink-0"
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-lg border border-border bg-raised px-5 py-5">
          <p className="font-mono text-xs uppercase tracking-[0.16em] text-dim">
            {locale === "fr" ? "notes utiles" : "quick notes"}
          </p>
          <p className="mt-4 text-sm leading-relaxed text-muted">
            {installFlow.requirements}
          </p>

          <div className="mt-6 border-t border-border pt-4">
            <p className="font-mono text-xs uppercase tracking-[0.16em] text-dim">
              {locale === "fr" ? "commandes utiles" : "useful commands"}
            </p>
            <ul className="mt-4 space-y-2">
              {installFlow.options.map((option) => (
                <li key={option} className="rounded-md border border-border bg-inset px-3 py-2">
                  <code className="block overflow-x-auto whitespace-nowrap font-mono text-xs text-amber">
                    {option}
                  </code>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}
