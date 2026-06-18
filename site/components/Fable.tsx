"use client";

import TerminalCard from "@/components/TerminalCard";
import { useContent } from "@/lib/content";

export default function Fable() {
  const { fable: fableContent } = useContent();
  const [command, ...rest] = fableContent.example.split(" ");
  const remainder = rest.join(" ");

  return (
    <section
      id="fable"
      className="mx-auto w-full max-w-5xl px-6 py-16 sm:py-20"
    >
      <div className="rounded-lg border border-border bg-raised px-6 py-8 sm:px-10 sm:py-10">
        <div className="grid grid-cols-1 gap-8 md:grid-cols-2 md:items-center">
          <div className="flex flex-col gap-3">
            <span className="font-mono text-xs uppercase tracking-[0.2em] text-amber">
              {fableContent.tag}
            </span>
            <h3 className="font-serif text-2xl leading-tight text-text sm:text-3xl">
              {fableContent.h3}
            </h3>
            <p className="text-sm text-muted">{fableContent.paragraph}</p>
          </div>

          <TerminalCard>
            <p className="break-words">
              <span className="text-amber">{command}</span>
              {remainder ? <span className="text-text"> {remainder}</span> : null}
            </p>
          </TerminalCard>
        </div>
      </div>
    </section>
  );
}
