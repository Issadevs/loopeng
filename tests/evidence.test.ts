import { describe, expect, it } from "vitest";
import { resolveEvidence, type DigestReader } from "../src/evidence.js";
import type { Candidate } from "../src/types.js";

function candidate(evidence: Candidate["evidence"]): Candidate {
  return {
    id: "cand-1",
    type: "recurring_task",
    summary: "x",
    confidence: 0.9,
    occurrences: 3,
    impactEstimate: "m",
    suggestedTool: "claude-code",
    evidence,
  };
}

// digestSession output: header line, then one line per event.
function digest(sessionId: string, eventLines: string[]): string {
  return [`=== session ${sessionId} tool=claude-code cwd=/app`, ...eventLines].join("\n");
}

const TS = "2026-06-12T12:00:00.000Z";

function reader(map: Record<string, string>): DigestReader {
  return (id) => map[id];
}

describe("resolveEvidence", () => {
  it("maps event indices to digest body lines and extracts commands", () => {
    const d = digest("s-1", [
      `U ${TS} please deploy`,
      `C ${TS} git push origin main`,
      `C ${TS} npm run deploy`,
    ]);
    const resolved = resolveEvidence(candidate([{ sessionId: "s-1", events: [1, 2] }]), reader({ "s-1": d }));

    expect(resolved.occurrences).toHaveLength(1);
    expect(resolved.occurrences[0].lines).toEqual([
      { kind: "command", raw: "git push origin main", command: "git push origin main", program: "git" },
      { kind: "command", raw: "npm run deploy", command: "npm run deploy", program: "npm" },
    ]);
    expect(resolved.programs.sort()).toEqual(["git", "npm"]);
    expect(resolved.hasCommands).toBe(true);
  });

  it("collects the union of programs across occurrences", () => {
    const d1 = digest("s-1", [`C ${TS} git push origin feature-x`]);
    const d2 = digest("s-2", [`C ${TS} git push origin feature-y`]);
    const resolved = resolveEvidence(
      candidate([
        { sessionId: "s-1", events: [0] },
        { sessionId: "s-2", events: [0] },
      ]),
      reader({ "s-1": d1, "s-2": d2 }),
    );
    expect(resolved.occurrences).toHaveLength(2);
    expect(resolved.programs).toEqual(["git"]);
  });

  it("ignores out-of-range and negative indices", () => {
    const d = digest("s-1", [`C ${TS} ls`]);
    const resolved = resolveEvidence(candidate([{ sessionId: "s-1", events: [0, 5, -1] }]), reader({ "s-1": d }));
    expect(resolved.occurrences[0].lines).toHaveLength(1);
    expect(resolved.programs).toEqual(["ls"]);
  });

  it("skips sessions with no digest on disk", () => {
    const resolved = resolveEvidence(candidate([{ sessionId: "missing", events: [0] }]), reader({}));
    expect(resolved.occurrences).toEqual([]);
    expect(resolved.hasCommands).toBe(false);
  });

  it("classifies non-command lines and reports hasCommands=false when none are commands", () => {
    const d = digest("s-1", [`U ${TS} hello`, `E ${TS} build failed`, `T ${TS} Read: foo.ts`]);
    const resolved = resolveEvidence(candidate([{ sessionId: "s-1", events: [0, 1, 2] }]), reader({ "s-1": d }));
    expect(resolved.occurrences[0].lines.map((l) => l.kind)).toEqual(["user_msg", "error", "tool_call"]);
    expect(resolved.hasCommands).toBe(false);
  });
});
