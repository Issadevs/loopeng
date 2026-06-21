"use client";

import Critter from "@/components/Critter";
import { useContent } from "@/lib/content";

export default function Footer() {
  const { footer: footerContent } = useContent();
  return (
    <footer className="border-t border-border">
      <div className="mx-auto w-full max-w-5xl px-6 py-16">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="font-mono text-sm text-dim">{footerContent.copyright}</p>
          <nav className="flex flex-wrap gap-x-6 gap-y-2">
            {footerContent.links.map((link) => {
              const external = link.href.startsWith("http");
              return (
                <a
                  key={link.label}
                  href={link.href}
                  className="font-mono text-sm text-muted transition-colors hover:text-amber"
                  {...(external ? { target: "_blank", rel: "noreferrer" } : {})}
                >
                  {link.label}
                </a>
              );
            })}
          </nav>
        </div>

        <div className="my-10 flex justify-center">
          <Critter mood="idle" animate size={1.5} />
        </div>

        <p className="text-center font-serif text-base italic text-muted">
          {footerContent.tagline}
        </p>
      </div>
    </footer>
  );
}
