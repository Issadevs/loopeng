import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Candidate } from "./types.js";
import { loopengHome } from "./state.js";

/**
 * Resolve a candidate's evidence (sessionId + event indices) back into the real
 * terminal lines the developer performed. A session digest is `header + one
 * line per event` in original order, so an event index maps directly to a body
 * line. Feeding these concrete lines to the tool generator is what lets it
 * reproduce what you actually did instead of guessing from a one-line summary —
 * and the extracted command set is the allow-list that keeps it from inventing
 * commands you never ran.
 */

export type EvidenceKind = "user_msg" | "command" | "tool_call" | "error" | "other";

export interface EvidenceLine {
  kind: EvidenceKind;
  raw: string; // the digest line with its kind+timestamp prefix stripped
  command?: string; // full command string (kind === "command")
  program?: string; // argv[0] of the command (kind === "command")
}

export interface ResolvedOccurrence {
  sessionId: string;
  lines: EvidenceLine[];
}

export interface ResolvedEvidence {
  occurrences: ResolvedOccurrence[];
  programs: string[]; // unique command programs (argv[0]) seen across all evidence
  hasCommands: boolean;
}

export type DigestReader = (sessionId: string) => string | undefined;

/** Default reader: load `~/.loopeng/digests/<sessionId>.txt`. */
export function diskDigestReader(): DigestReader {
  return (sessionId) => {
    const path = join(loopengHome(), "digests", `${sessionId}.txt`);
    if (!existsSync(path)) {
      return undefined;
    }
    try {
      return readFileSync(path, "utf8");
    } catch {
      return undefined;
    }
  };
}

const KIND_BY_LETTER: Record<string, EvidenceKind> = {
  U: "user_msg",
  C: "command",
  T: "tool_call",
  E: "error",
};

// Matches "<letter> <timestamp> <rest>" as produced by digester.ts.
const LINE_RE = /^([UCTE])\s+\S+\s+(.*)$/;

function parseLine(line: string): EvidenceLine {
  const m = line.match(LINE_RE);
  if (m === null) {
    return { kind: "other", raw: line };
  }
  const kind = KIND_BY_LETTER[m[1]] ?? "other";
  const raw = m[2];
  if (kind === "command") {
    const program = raw.split(/\s+/)[0] || undefined;
    return { kind, raw, command: raw, program };
  }
  return { kind, raw };
}

export function resolveEvidence(
  candidate: Candidate,
  read: DigestReader = diskDigestReader(),
): ResolvedEvidence {
  const occurrences: ResolvedOccurrence[] = [];
  const programs = new Set<string>();

  for (const ev of candidate.evidence) {
    const digest = read(ev.sessionId);
    if (digest === undefined) {
      continue;
    }
    // Drop the header line; the remaining lines are events in index order.
    const body = digest.split("\n").slice(1);
    const lines: EvidenceLine[] = [];
    for (const idx of ev.events) {
      if (!Number.isInteger(idx) || idx < 0 || idx >= body.length) {
        continue;
      }
      const parsed = parseLine(body[idx]);
      lines.push(parsed);
      if (parsed.program !== undefined) {
        programs.add(parsed.program);
      }
    }
    if (lines.length > 0) {
      occurrences.push({ sessionId: ev.sessionId, lines });
    }
  }

  return { occurrences, programs: [...programs], hasCommands: programs.size > 0 };
}
