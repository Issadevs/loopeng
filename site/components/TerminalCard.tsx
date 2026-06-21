import type { ReactNode } from "react";

interface TerminalCardProps {
  title?: string;
  children: ReactNode;
  className?: string;
}

export default function TerminalCard({ title, children, className = "" }: TerminalCardProps) {
  return (
    <div className={`overflow-hidden border border-border bg-inset ${className}`}>
      <div className="flex items-center gap-2 border-b border-border bg-raised px-3 py-2">
        <div className="flex items-center gap-1.5" aria-hidden="true">
          <span className="h-2 w-2 rounded-full bg-border-bright" />
          <span className="h-2 w-2 rounded-full bg-border-bright" />
          <span className="h-2 w-2 rounded-full bg-amber/60" />
        </div>
        {title ? (
          <span className="ml-1 font-mono text-xs text-dim">{title}</span>
        ) : null}
      </div>
      <div className="p-4 font-mono text-sm text-text">{children}</div>
    </div>
  );
}
