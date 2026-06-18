"use client";

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import SectionLabel from "@/components/SectionLabel";
import { useContent } from "@/lib/content";

// Per-line coloring inside a node's terminal mock. Tone is driven by the
// leading glyph so the same helper serves every stage.
function colorizeLine(line: string): ReactNode {
  if (line.startsWith("✓")) return <span className="text-green">{line}</span>;
  if (line.startsWith("▶")) return <span className="text-green">{line}</span>;
  if (line.startsWith("🔒")) return <span className="text-amber">{line}</span>;
  if (line.startsWith("loopeng-tools") || line.includes("deploy_staging("))
    return <span className="text-amber">{line}</span>;
  return <span className="text-muted">{line}</span>;
}

// Reveal transition for a node, staggered by its position once in view.
function reveal(inView: boolean, index: number): CSSProperties {
  return {
    opacity: inView ? 1 : 0,
    transform: inView ? "none" : "translateY(14px)",
    transition: "opacity 0.55s ease-out, transform 0.55s ease-out",
    transitionDelay: `${index * 0.12}s`,
  };
}

// Reveal on scroll-in via IntersectionObserver. Under prefers-reduced-motion,
// globals.css forces transition-duration to ~0, so the reveal still fires when
// the node is observed — it just lands instantly with no movement.
function useInView<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            setInView(true);
            obs.disconnect();
            break;
          }
        }
      },
      { threshold: 0.2 },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);
  return { ref, inView };
}

export default function HowItWorks() {
  const { pipeline, sectionLabels } = useContent();
  const { ref, inView } = useInView<HTMLDivElement>();
  const last = pipeline.steps.length - 1;

  return (
    <section id="how" className="mx-auto w-full max-w-7xl px-6 py-24 sm:py-32">
      <SectionLabel>{sectionLabels.pipeline}</SectionLabel>

      <h2 className="mt-6 max-w-3xl font-serif text-4xl leading-tight text-text sm:text-5xl">
        {pipeline.heading}
      </h2>
      <p className="mt-4 max-w-2xl font-mono text-sm leading-relaxed text-muted sm:text-base">
        {pipeline.sub}
      </p>

      {/* Privacy boundary: a dashed enclosure makes "stays on your machine"
          literal — the whole flow lives inside one box. */}
      <div
        ref={ref}
        className="relative mt-14 rounded-2xl border border-dashed border-border-bright/70 p-5 sm:p-8"
      >
        <span className="absolute -top-3 left-6 bg-bg px-2 font-mono text-[10px] uppercase tracking-[0.18em] text-dim">
          🔒 {pipeline.boundary}
        </span>

        <ol className="grid gap-x-4 gap-y-8 md:grid-cols-2 xl:grid-cols-5">
          {pipeline.steps.map((step, index) => {
            const isLast = index === last;
            return (
              <li
                key={step.n}
                className="relative flex flex-col gap-3"
                style={reveal(inView, index)}
              >
                {/* Flow connector to the next node (desktop only, decorative). */}
                {!isLast ? (
                  <span
                    aria-hidden="true"
                    className="pointer-events-none absolute -right-[1.15rem] top-7 hidden font-mono text-base text-border-bright xl:block"
                  >
                    →
                  </span>
                ) : null}

                <div className="flex items-baseline gap-2.5">
                  <span className="font-mono text-2xl leading-none text-dim">{step.n}</span>
                  <h3
                    className={`font-serif text-xl font-bold ${isLast ? "text-green" : "text-amber"}`}
                  >
                    {step.title}
                  </h3>
                </div>

                <p className="text-sm leading-relaxed text-muted">{step.desc}</p>

                <div
                  className={`mt-auto rounded-lg border bg-inset px-3 py-2.5 font-mono text-xs leading-relaxed ${
                    isLast ? "border-green/40" : "border-border"
                  }`}
                >
                  {step.mockLines.map((line, i) => (
                    <span key={i} className="block whitespace-pre-wrap break-words">
                      {colorizeLine(line)}
                    </span>
                  ))}
                </div>
              </li>
            );
          })}
        </ol>
      </div>

      <p className="mt-8 flex items-center gap-2 font-mono text-sm text-text">
        <span aria-hidden="true" className="text-green">
          ▸
        </span>
        {pipeline.outcome}
      </p>
    </section>
  );
}
