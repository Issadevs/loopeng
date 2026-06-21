"use client";

import Critter from "@/components/Critter";
import { useContent } from "@/lib/content";

export default function NeverGuilt() {
  const { neverGuilt, neverGuiltEmphasis } = useContent();
  const idx = neverGuilt.lastIndexOf(neverGuiltEmphasis);
  const lead = idx >= 0 ? neverGuilt.slice(0, idx) : neverGuilt;
  const tail = idx >= 0 ? neverGuilt.slice(idx) : "";
  return (
    <section className="mx-auto w-full max-w-5xl px-6 py-12">
      <div className="relative overflow-hidden rounded-lg border border-border bg-raised px-6 py-6 sm:flex sm:items-center sm:gap-8 sm:px-10 sm:py-8">
        {/* Subtle amber glow anchored to the mascot side */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 opacity-[0.03]"
          style={{ background: "radial-gradient(circle at 0% 50%, var(--amber) 0%, transparent 60%)" }}
        />
        <div className="relative shrink-0 text-center sm:text-left">
          <Critter mood="smile" animate={false} />
        </div>
        <p className="relative mt-4 font-mono text-sm leading-relaxed text-muted sm:mt-0">
          {lead}
          {tail && <span className="text-text">{tail}</span>}
        </p>
      </div>
    </section>
  );
}
