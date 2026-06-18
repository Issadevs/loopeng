"use client";

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import SectionLabel from "@/components/SectionLabel";
import { useContent } from "@/lib/content";

// Highlight ${param} placeholders inside a step string.
function colorizePlaceholders(text: string): ReactNode[] {
  return text.split(/(\$\{[a-z_]+\})/i).map((part, i) =>
    /^\$\{[a-z_]+\}$/i.test(part) ? (
      <span key={i} className="text-amber">
        {part}
      </span>
    ) : (
      <span key={i}>{part}</span>
    ),
  );
}

// Highlight the token that varied across runs (the part that becomes a param).
function colorizeObserved(line: string): ReactNode[] {
  return line.split(/(feature-[a-z]+)/i).map((part, i) =>
    /^feature-[a-z]+$/i.test(part) ? (
      <span key={i} className="text-blue">
        {part}
      </span>
    ) : (
      <span key={i} className="text-muted">
        {part}
      </span>
    ),
  );
}

function reveal(inView: boolean, index: number): CSSProperties {
  return {
    opacity: inView ? 1 : 0,
    transform: inView ? "none" : "translateY(14px)",
    transition: "opacity 0.6s ease-out, transform 0.6s ease-out",
    transitionDelay: `${index * 0.14}s`,
  };
}

function Arrow() {
  // Points right on xl (horizontal layout), down otherwise.
  return (
    <div
      aria-hidden="true"
      className="flex items-center justify-center font-mono text-xl text-border-bright"
    >
      <span className="xl:hidden">↓</span>
      <span className="hidden xl:inline">→</span>
    </div>
  );
}

function Panel({
  title,
  tone,
  children,
  style,
}: {
  title: string;
  tone: "muted" | "amber" | "green";
  children: ReactNode;
  style?: CSSProperties;
}) {
  const ring =
    tone === "amber" ? "border-amber/40" : tone === "green" ? "border-green/40" : "border-border";
  const head = tone === "amber" ? "text-amber" : tone === "green" ? "text-green" : "text-dim";
  return (
    <div
      style={style}
      className={`flex min-w-0 flex-1 flex-col rounded-xl border ${ring} bg-inset p-4`}
    >
      <span className={`font-mono text-[10px] uppercase tracking-[0.16em] ${head}`}>{title}</span>
      <div className="mt-3 min-w-0">{children}</div>
    </div>
  );
}

export default function ToolAnatomy() {
  const { toolAnatomy: t, sectionLabels } = useContent();
  const ref = useRef<HTMLDivElement>(null);
  const [inView, setInView] = useState(false);

  // Reveal on scroll-in; globals.css neutralizes the transition under
  // prefers-reduced-motion, so reduced-motion users get an instant reveal.
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

  return (
    <section id="tool" className="mx-auto w-full max-w-7xl px-6 py-24 sm:py-32">
      <SectionLabel>{sectionLabels.tool}</SectionLabel>

      <h2 className="mt-6 max-w-3xl font-serif text-4xl leading-tight text-text sm:text-5xl">
        {t.heading}
      </h2>
      <p className="mt-4 max-w-2xl font-mono text-sm leading-relaxed text-muted sm:text-base">
        {t.sub}
      </p>

      <div
        ref={ref}
        className="mt-14 grid items-stretch gap-3 xl:grid-cols-[1fr_auto_1fr_auto_1fr]"
      >
        {/* 1 — what loopeng observed */}
        <Panel title={t.observedTitle} tone="muted" style={reveal(inView, 0)}>
          <div className="space-y-1 font-mono text-xs leading-relaxed">
            {t.observed.map((line, i) => (
              <p key={i} className="whitespace-pre-wrap break-words">
                {colorizeObserved(line)}
              </p>
            ))}
          </div>
        </Panel>

        <div style={reveal(inView, 1)}>
          <Arrow />
        </div>

        {/* 2 — the generated tool */}
        <Panel title={t.toolTitle} tone="amber" style={reveal(inView, 2)}>
          <code className="font-mono text-sm text-amber">
            {t.toolName}(
            {t.params.map((p, i) => (
              <span key={p.name}>
                {i > 0 ? ", " : ""}
                <span className="text-text">{p.name}</span>
                <span className="text-dim">: {p.type}</span>
              </span>
            ))}
            )
          </code>
          <p className="mt-1 font-mono text-xs text-muted">{t.toolDesc}</p>
          <div className="mt-3 space-y-1 border-t border-border pt-3 font-mono text-xs leading-relaxed">
            {t.steps.map((step, i) => (
              <p key={i} className="whitespace-pre-wrap break-words text-text">
                <span className="text-dim">$ </span>
                {colorizePlaceholders(step)}
              </p>
            ))}
          </div>
        </Panel>

        <div style={reveal(inView, 3)}>
          <Arrow />
        </div>

        {/* 3 — an agent calling it */}
        <Panel title={t.callTitle} tone="green" style={reveal(inView, 4)}>
          <div className="rounded-md border border-green/30 bg-bg px-3 py-2 font-mono text-sm">
            <span className="text-green">{t.call}</span>
          </div>
        </Panel>
      </div>

      {/* Safety chips — the trust story in one row. */}
      <ul className="mt-8 flex flex-wrap gap-2.5">
        {t.safety.map((s) => (
          <li
            key={s}
            className="inline-flex items-center gap-2 rounded-full border border-border bg-inset px-3 py-1.5 font-mono text-xs text-muted"
          >
            <span aria-hidden="true" className="text-green">
              ✓
            </span>
            {s}
          </li>
        ))}
      </ul>
    </section>
  );
}
