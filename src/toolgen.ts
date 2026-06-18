import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Candidate } from "./types.js";
import { parseFirstJson } from "./shared/json.js";
import { type ToolSpec, ToolSpecError, validateToolSpec } from "./toolspec.js";
import type { ResolvedEvidence } from "./evidence.js";

/**
 * Second half of the golden idea: where generator.ts writes a prose loop.md,
 * this turns an approved candidate into a machine-runnable MCP tool spec
 * (tool.json) so a future agent can invoke the workflow as a single tool call.
 *
 * Same Maker → Checker → one-revision shape as the loop generator, but the
 * structural gate here is validateToolSpec: the maker's JSON must parse into a
 * fully valid, injection-safe spec or it is rejected.
 */

export type LlmRunner = (prompt: string) => Promise<string>;

export interface GenerateToolOptions {
  runner: LlmRunner;
  bundleDir: string; // tool.json is written here (alongside loop.md)
  evidence?: ResolvedEvidence; // the real terminal lines, to ground the synthesis
}

export type GenerateToolResult =
  | { ok: true; toolPath: string; spec: ToolSpec }
  | { ok: false; reason: string };

const MAKER_PROMPT = `You convert an approved automation candidate into a machine-runnable MCP tool spec.

The spec describes a parameterised sequence of terminal commands that an AI agent can later invoke as a single tool call to perform the workflow automatically.

Output EXACTLY one fenced json block and nothing else:
\`\`\`json
{
  "name": "snake_case_tool_name",
  "description": "One sentence an agent reads to decide when to call this tool.",
  "parameters": [
    { "name": "branch", "type": "string", "description": "...", "required": true }
  ],
  "steps": [
    { "argv": ["git", "checkout", "\${branch}"] }
  ]
}
\`\`\`

Hard rules — a spec breaking any of these is rejected:
- "name": lowercase snake_case, 3-64 chars, matching ^[a-z][a-z0-9_]{2,63}$.
- "parameters": array (may be empty). Each has name (^[a-z][a-z0-9_]*$), type ("string"|"number"|"boolean"), a description, and required (boolean).
- "steps": non-empty array. Each step is {"argv": [...]} — a NON-EMPTY argv array of string tokens. argv[0] is the literal program name (e.g. "git", "npm") and MUST NOT contain a placeholder.
- Reference a parameter inside a token as \${paramName}. Every referenced parameter must be declared AND required.
- Commands run via execFile WITHOUT a shell. Do NOT use shell features: no pipes, &&, ;, $(...), backticks, globbing, redirection, or "bash -c". Express multi-command workflows as multiple steps.
- Ground every step in the observed terminal activity below. argv[0] of each step MUST be one of the allowed commands. Do not invent tools the developer did not run.
- Compare the occurrences: tokens that DIFFER across runs are the parameters; tokens that stay constant must remain literal.

Output ONLY the fenced json block. No prose before or after.`;

const CHECKER_PROMPT = `You are the CHECKER for an MCP tool spec. Critique it; do NOT rewrite it.

Judge strictly:
- Steps reproduce the candidate's actual workflow (no invented commands).
- No shell features anywhere (no pipes, &&, ;, $(...), backticks, redirection, "bash -c"). Each step is a single program invocation.
- Parameters are necessary and each referenced placeholder is declared and required.
- The description tells an agent precisely when to call the tool.

Return ONLY a JSON object: {"verdict": "pass"|"fail", "problems": ["..."]}.
If verdict is "pass", problems may be empty.`;

function describeCandidate(c: Candidate): string {
  return [
    `Candidate id: ${c.id}`,
    `Type: ${c.type}`,
    `Summary: ${c.summary}`,
    `Impact estimate: ${c.impactEstimate}`,
    `Evidence count: ${c.evidence.length}`,
  ].join("\n");
}

const LINE_TAG: Record<string, string> = {
  command: "$",
  user_msg: "you:",
  tool_call: "tool:",
  error: "error:",
  other: "·",
};

/** Render the resolved evidence as concrete, occurrence-grouped activity. */
function evidenceBlock(evidence: ResolvedEvidence): string {
  const occurrences = evidence.occurrences
    .map((o, i) => {
      const body = o.lines.map((l) => `  ${LINE_TAG[l.kind] ?? "·"} ${l.raw}`).join("\n");
      return `Occurrence ${i + 1} (session ${o.sessionId}):\n${body}`;
    })
    .join("\n\n");

  return [
    "Observed terminal activity (the real lines you performed):",
    occurrences,
    "",
    `Allowed commands — argv[0] MUST be one of: ${evidence.programs.join(", ")}`,
  ].join("\n");
}

function makerInput(c: Candidate, evidence?: ResolvedEvidence, problems?: string[]): string {
  const parts = [MAKER_PROMPT, "", "Candidate:", describeCandidate(c)];
  if (evidence !== undefined && evidence.hasCommands) {
    parts.push("", evidenceBlock(evidence));
  }
  if (problems !== undefined && problems.length > 0) {
    parts.push("", `Revise. Problems: ${problems.join("; ")}`);
  }
  return parts.join("\n");
}

/**
 * Deterministic anti-hallucination gate: every step's command must be one the
 * developer was actually observed running. Skipped when no commands could be
 * resolved (e.g. digests pruned), so generation still works, just ungrounded.
 */
function groundingProblems(spec: ToolSpec, evidence?: ResolvedEvidence): string[] {
  if (evidence === undefined || !evidence.hasCommands) {
    return [];
  }
  const allowed = new Set(evidence.programs);
  const problems: string[] = [];
  for (const step of spec.steps) {
    const cmd = step.argv[0];
    if (!allowed.has(cmd)) {
      problems.push(
        `step command "${cmd}" was never observed in your sessions — use only: ${evidence.programs.join(", ")}`,
      );
    }
  }
  return problems;
}

function checkerInput(c: Candidate, toolJson: string): string {
  return [CHECKER_PROMPT, "", "Candidate:", describeCandidate(c), "", "tool.json:", toolJson].join(
    "\n",
  );
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

interface CheckerResult {
  verdict: "pass" | "fail";
  problems: string[];
}

function parseChecker(raw: string): CheckerResult | undefined {
  const parsed = parseFirstJson(raw);
  if (!isObject(parsed)) {
    return undefined;
  }
  const verdict = parsed.verdict;
  if (verdict !== "pass" && verdict !== "fail") {
    return undefined;
  }
  const problems = Array.isArray(parsed.problems)
    ? parsed.problems.filter((p): p is string => typeof p === "string")
    : [];
  return { verdict, problems };
}

async function runChecker(
  c: Candidate,
  toolJson: string,
  runner: LlmRunner,
): Promise<CheckerResult> {
  const first = parseChecker(await runner(checkerInput(c, toolJson)));
  if (first !== undefined) {
    return first;
  }
  const second = parseChecker(await runner(checkerInput(c, toolJson)));
  if (second !== undefined) {
    return second;
  }
  return { verdict: "fail", problems: ["Checker output could not be parsed."] };
}

interface Attempt {
  ok: boolean;
  problems: string[];
  spec?: ToolSpec;
}

async function attempt(
  c: Candidate,
  runner: LlmRunner,
  evidence?: ResolvedEvidence,
  problems?: string[],
): Promise<Attempt> {
  const raw = await runner(makerInput(c, evidence, problems));

  // Structural gate: the maker output must parse into a valid, safe spec.
  const parsed = parseFirstJson(raw);
  let spec: ToolSpec;
  try {
    spec = validateToolSpec(parsed, c.id);
  } catch (e) {
    const reason = e instanceof ToolSpecError ? e.message : `invalid spec: ${String(e)}`;
    return { ok: false, problems: [reason] };
  }

  // Grounding gate (deterministic, cheap): reject invented commands before
  // spending an LLM call on the checker.
  const grounding = groundingProblems(spec, evidence);
  if (grounding.length > 0) {
    return { ok: false, problems: grounding };
  }

  const checker = await runChecker(c, raw, runner);
  if (checker.verdict !== "pass") {
    return { ok: false, problems: checker.problems };
  }

  return { ok: true, problems: [], spec };
}

function writeToolSpec(bundleDir: string, spec: ToolSpec): string {
  mkdirSync(bundleDir, { recursive: true });
  const toolPath = join(bundleDir, "tool.json");
  writeFileSync(toolPath, `${JSON.stringify(spec, null, 2)}\n`, "utf8");
  return toolPath;
}

/**
 * Generate and persist a tool.json for a candidate. Best-effort by design:
 * callers treat a failure as "no MCP tool this time" rather than fatal, so an
 * approved loop is never blocked by tool synthesis.
 */
export async function generateToolSpec(
  c: Candidate,
  opts: GenerateToolOptions,
): Promise<GenerateToolResult> {
  let result = await attempt(c, opts.runner, opts.evidence);
  if (!result.ok) {
    // ONE revision cycle: re-ask the maker with the problems appended.
    result = await attempt(c, opts.runner, opts.evidence, result.problems);
  }

  if (!result.ok || result.spec === undefined) {
    return { ok: false, reason: `tool spec generation failed: ${result.problems.join("; ")}` };
  }

  const toolPath = writeToolSpec(opts.bundleDir, result.spec);
  return { ok: true, toolPath, spec: result.spec };
}

/** Read a tool.json from a bundle dir, returning undefined if absent/invalid. */
export function readToolSpec(bundleDir: string, loopId: string): ToolSpec | undefined {
  const path = join(bundleDir, "tool.json");
  if (!existsSync(path)) {
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return undefined;
  }
  try {
    return validateToolSpec(parsed, loopId);
  } catch {
    return undefined;
  }
}
