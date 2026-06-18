import { mkdtemp, readFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Candidate } from "../src/types.js";
import { generateToolSpec, readToolSpec, type LlmRunner } from "../src/toolgen.js";
import type { ResolvedEvidence } from "../src/evidence.js";

let bundleDir: string;

beforeEach(async () => {
  bundleDir = await mkdtemp(join(tmpdir(), "loopeng-toolgen-"));
});

afterEach(async () => {
  await rm(bundleDir, { recursive: true, force: true });
});

const candidate: Candidate = {
  id: "cand-1",
  type: "recurring_task",
  summary: "Push current branch and run tests",
  evidence: [{ sessionId: "s-1", events: [0, 2] }],
  occurrences: 3,
  confidence: 0.9,
  suggestedTool: "claude-code",
  impactEstimate: "saves ~20 min/week",
};

function validToolJson(overrides: Record<string, unknown> = {}): string {
  const spec = {
    name: "push_and_test",
    description: "Push the branch then run the test suite.",
    parameters: [{ name: "branch", type: "string", description: "branch to push", required: true }],
    steps: [
      { argv: ["git", "push", "origin", "${branch}"] },
      { argv: ["npm", "test"] },
    ],
    ...overrides,
  };
  return ["here you go:", "```json", JSON.stringify(spec, null, 2), "```"].join("\n");
}

const checkerPass = '{"verdict": "pass", "problems": []}';
const checkerFail = '{"verdict": "fail", "problems": ["invented a command"]}';

function scriptedRunner(responses: string[]): { run: LlmRunner; prompts: string[] } {
  const prompts: string[] = [];
  let i = 0;
  const run: LlmRunner = async (prompt: string) => {
    prompts.push(prompt);
    if (i >= responses.length) {
      throw new Error(`No scripted response for call ${i}`);
    }
    return responses[i++];
  };
  return { run, prompts };
}

describe("generateToolSpec", () => {
  it("happy path: valid maker + checker pass writes tool.json", async () => {
    const { run } = scriptedRunner([validToolJson(), checkerPass]);
    const result = await generateToolSpec(candidate, { runner: run, bundleDir });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.spec.name).toBe("push_and_test");
    expect(result.spec.loopId).toBe("cand-1");

    const onDisk = JSON.parse(await readFile(join(bundleDir, "tool.json"), "utf8"));
    expect(onDisk.loopId).toBe("cand-1");
    expect(onDisk.steps).toHaveLength(2);
  });

  it("invalid maker spec (shell placeholder in command) → revision → success", async () => {
    const bad = validToolJson({ steps: [{ argv: ["${branch}", "push"] }] });
    const { run, prompts } = scriptedRunner([bad, validToolJson(), checkerPass]);

    const result = await generateToolSpec(candidate, { runner: run, bundleDir });

    expect(result.ok).toBe(true);
    expect(prompts[1]).toContain("Revise. Problems:");
    expect(prompts[1]).toContain("argv[0]");
  });

  it("unparseable maker output → revision uses the problem → success", async () => {
    const { run, prompts } = scriptedRunner(["not json at all", validToolJson(), checkerPass]);
    const result = await generateToolSpec(candidate, { runner: run, bundleDir });

    expect(result.ok).toBe(true);
    expect(prompts[1]).toContain("Revise. Problems:");
  });

  it("checker fails twice → ok:false and no tool.json written", async () => {
    const { run } = scriptedRunner([validToolJson(), checkerFail, validToolJson(), checkerFail]);
    const result = await generateToolSpec(candidate, { runner: run, bundleDir });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("invented a command");
    expect(existsSync(join(bundleDir, "tool.json"))).toBe(false);
  });

  it("checker garbage once then valid still passes (re-ask path)", async () => {
    const { run } = scriptedRunner([validToolJson(), "garbage", checkerPass]);
    const result = await generateToolSpec(candidate, { runner: run, bundleDir });
    expect(result.ok).toBe(true);
  });
});

describe("evidence grounding", () => {
  // Allowed commands resolved from the developer's real sessions.
  const evidence: ResolvedEvidence = {
    occurrences: [
      {
        sessionId: "s-1",
        lines: [{ kind: "command", raw: "git push origin main", command: "git push origin main", program: "git" }],
      },
    ],
    programs: ["git", "npm"],
    hasCommands: true,
  };

  it("feeds the observed activity into the maker prompt", async () => {
    const { run, prompts } = scriptedRunner([validToolJson(), checkerPass]);
    await generateToolSpec(candidate, { runner: run, bundleDir, evidence });
    expect(prompts[0]).toContain("Observed terminal activity");
    expect(prompts[0]).toContain("git push origin main");
    expect(prompts[0]).toContain("Allowed commands");
  });

  it("rejects a hallucinated command and revises with a grounding problem", async () => {
    // First maker uses 'kubectl' (never observed); revision returns a grounded spec.
    const hallucinated = validToolJson({ steps: [{ argv: ["kubectl", "apply"] }], parameters: [] });
    const { run, prompts } = scriptedRunner([hallucinated, validToolJson(), checkerPass]);

    const result = await generateToolSpec(candidate, { runner: run, bundleDir, evidence });

    expect(result.ok).toBe(true);
    expect(prompts[1]).toContain("Revise. Problems:");
    expect(prompts[1]).toContain('"kubectl" was never observed');
  });

  it("does not call the checker when the grounding gate fails", async () => {
    const hallucinated = validToolJson({ steps: [{ argv: ["kubectl", "apply"] }], parameters: [] });
    // Only two maker responses scripted, no checker responses — proves the
    // checker is never reached on the grounded-rejection path.
    const { run } = scriptedRunner([hallucinated, hallucinated]);

    const result = await generateToolSpec(candidate, { runner: run, bundleDir, evidence });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("was never observed");
  });

  it("accepts grounded commands without a checker objection", async () => {
    const { run } = scriptedRunner([validToolJson(), checkerPass]);
    const result = await generateToolSpec(candidate, { runner: run, bundleDir, evidence });
    expect(result.ok).toBe(true); // 'git' and 'npm' are both allowed
  });
});

describe("readToolSpec", () => {
  it("round-trips a written spec", async () => {
    const { run } = scriptedRunner([validToolJson(), checkerPass]);
    await generateToolSpec(candidate, { runner: run, bundleDir });

    const spec = readToolSpec(bundleDir, "cand-1");
    expect(spec?.name).toBe("push_and_test");
  });

  it("returns undefined when absent", () => {
    expect(readToolSpec(bundleDir, "cand-1")).toBeUndefined();
  });
});
