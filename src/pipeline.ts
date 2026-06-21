/**
 * A pipeline is a user-defined sequence of phases that loopEng drives Claude
 * Code (or Codex) through, one phase at a time. Each phase sends a well-defined
 * instruction to the agent, then an optional *gate* (a real command that must
 * exit 0) decides whether to advance. loopEng holds the run state between
 * phases, so a stopped or crashed run resumes from where it left off.
 *
 * This module is pure orchestration + validation: the agent and the gate
 * executor are injected, so the whole thing is testable without a real `claude`
 * or running real commands.
 */
import { existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";

import { loopengHome, readJson, writeJsonAtomic } from "./state.js";
import { extractFirstJsonObject } from "./shared/json.js";
import { isBlockedCommand } from "./toolspec.js";

// ── Model ────────────────────────────────────────────────────────────────────

export interface PipelinePhase {
  name: string; // short label, e.g. "implement"
  instruction: string; // the task handed to the agent (claude -p)
  gate?: string[]; // argv; exit 0 = advance. omitted = always advance
  maxAttempts?: number; // re-run the phase (with gate feedback) on failure; default 1
}

export interface Pipeline {
  id: string;
  description?: string;
  workingDir?: string; // cwd for gate commands
  phases: PipelinePhase[];
}

export interface PipelineRunState {
  phaseIndex: number; // the next phase to run
}

export interface PipelineResult {
  ok: boolean;
  completed: string[]; // phase names that passed
  stoppedAt?: string; // phase name where it stopped
  reason?: string;
  log: string[];
}

export class PipelineError extends Error {}

const ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const NAME_RE = /^[a-z0-9][a-z0-9_-]{0,31}$/i;
// Tunable validation limits. The CLI builds these from LoopEngConfig and passes
// them in; tests and the on-load sanity re-parse fall back to these defaults.
export interface PipelineLimits {
  maxPhases: number;
  maxInstructionChars: number;
  maxGateArgv: number;
  maxAttempts: number; // upper bound for a phase's maxAttempts
  defaultMaxAttempts: number; // applied when a phase omits maxAttempts
}

export const DEFAULT_PIPELINE_LIMITS: PipelineLimits = {
  maxPhases: 30,
  maxInstructionChars: 8000,
  maxGateArgv: 32,
  maxAttempts: 10,
  defaultMaxAttempts: 1
};

// Defensive per-argv-token cap — not worth a config knob.
const MAX_ARGV_TOKEN_CHARS = 4096;

// ── Validation ───────────────────────────────────────────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function reqString(value: unknown, path: string, max: number): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new PipelineError(`${path} must be a non-empty string`);
  }
  if (value.length > max) {
    throw new PipelineError(`${path} exceeds ${max} characters`);
  }
  return value;
}

function validateGate(value: unknown, path: string, limits: PipelineLimits): string[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new PipelineError(`${path} must be a non-empty array of argv tokens`);
  }
  if (value.length > limits.maxGateArgv) {
    throw new PipelineError(`${path} has more than ${limits.maxGateArgv} tokens`);
  }
  value.forEach((token, i) => {
    if (typeof token !== "string" || token === "") {
      throw new PipelineError(`${path}[${i}] must be a non-empty string`);
    }
    if (token.length > MAX_ARGV_TOKEN_CHARS) {
      throw new PipelineError(`${path}[${i}] exceeds ${MAX_ARGV_TOKEN_CHARS} characters`);
    }
  });
  // A gate runs via execFile (no shell). Reject a shell/interpreter as the
  // command, same as tool specs — otherwise a gate could smuggle in arbitrary
  // code (e.g. ["bash","-c","…"]).
  if (isBlockedCommand(value[0] as string)) {
    throw new PipelineError(
      `${path}[0] command "${value[0]}" is not allowed — shells/interpreters that run inline code are blocked`
    );
  }
  return value as string[];
}

function validatePhase(value: unknown, path: string, limits: PipelineLimits): PipelinePhase {
  if (!isRecord(value)) {
    throw new PipelineError(`${path} must be an object`);
  }
  const name = reqString(value.name, `${path}.name`, 32);
  if (!NAME_RE.test(name)) {
    throw new PipelineError(`${path}.name must match ${NAME_RE}`);
  }
  const phase: PipelinePhase = {
    name,
    instruction: reqString(value.instruction, `${path}.instruction`, limits.maxInstructionChars),
    // Resolve the default at definition time so the stored spec is explicit and
    // the run is deterministic regardless of later config changes.
    maxAttempts: limits.defaultMaxAttempts
  };
  if (value.gate !== undefined) {
    phase.gate = validateGate(value.gate, `${path}.gate`, limits);
  }
  if (value.maxAttempts !== undefined) {
    if (
      typeof value.maxAttempts !== "number" ||
      !Number.isInteger(value.maxAttempts) ||
      value.maxAttempts < 1 ||
      value.maxAttempts > limits.maxAttempts
    ) {
      throw new PipelineError(`${path}.maxAttempts must be an integer in 1..${limits.maxAttempts}`);
    }
    phase.maxAttempts = value.maxAttempts;
  }
  return phase;
}

/**
 * Strictly validate an untrusted value (file/stdin) into a Pipeline. Limits
 * default to DEFAULT_PIPELINE_LIMITS; the CLI passes config-derived limits so
 * everything is tunable via config.json.
 */
export function validatePipeline(
  value: unknown,
  id: string,
  limits: PipelineLimits = DEFAULT_PIPELINE_LIMITS
): Pipeline {
  if (!ID_RE.test(id)) {
    throw new PipelineError(`pipeline id "${id}" must match ${ID_RE}`);
  }
  if (!isRecord(value)) {
    throw new PipelineError("pipeline must be a JSON object");
  }
  if (!Array.isArray(value.phases) || value.phases.length === 0) {
    throw new PipelineError("pipeline.phases must be a non-empty array");
  }
  if (value.phases.length > limits.maxPhases) {
    throw new PipelineError(`pipeline.phases has more than ${limits.maxPhases} phases`);
  }
  const phases = value.phases.map((p, i) => validatePhase(p, `phases[${i}]`, limits));

  const pipeline: Pipeline = { id, phases };
  if (value.description !== undefined) {
    pipeline.description = reqString(value.description, "description", 200);
  }
  if (value.workingDir !== undefined) {
    pipeline.workingDir = reqString(value.workingDir, "workingDir", MAX_ARGV_TOKEN_CHARS);
  }
  return pipeline;
}

// ── Orchestration ─────────────────────────────────────────────────────────────

export interface PipelineDeps {
  // Run one phase's instruction through the agent (claude -p). `ok` is false on
  // a non-zero exit / thrown error.
  agent: (instruction: string, phase: PipelinePhase) => Promise<{ ok: boolean; output: string }>;
  // Run a gate command (execFile semantics, no shell). code 0 = pass.
  gate: (argv: string[], cwd?: string) => Promise<{ code: number; out: string }>;
  // Persist progress so a stopped/crashed run can resume; cleared on completion.
  saveState: (state: PipelineRunState) => void;
  clearState: () => void;
  log: (line: string) => void;
}

function gateFeedback(phase: PipelinePhase, out: string): string {
  const cmd = (phase.gate ?? []).join(" ");
  return `${phase.instruction}\n\nThe verification \`${cmd}\` failed last time:\n${out}\n\nFix the underlying issue so the check passes.`;
}

/**
 * Drive the pipeline from `start.phaseIndex` to the end. For each phase: run the
 * agent, then (if there is a gate) run the gate; on failure, retry the phase up
 * to maxAttempts with the gate output fed back to the agent. Stops at the first
 * agent error or exhausted gate, saving state so a later run resumes there.
 */
export async function runPipeline(
  pipeline: Pipeline,
  deps: PipelineDeps,
  start: PipelineRunState = { phaseIndex: 0 }
): Promise<PipelineResult> {
  const log: string[] = [];
  const record = (line: string): void => {
    log.push(line);
    deps.log(line);
  };
  const total = pipeline.phases.length;
  const completed: string[] = [];

  if (start.phaseIndex > 0) {
    record(`resuming "${pipeline.id}" at phase ${start.phaseIndex + 1}/${total}`);
  }

  for (let index = start.phaseIndex; index < total; index += 1) {
    const phase = pipeline.phases[index]!;
    const maxAttempts = Math.max(1, phase.maxAttempts ?? 1);
    let passed = false;
    let lastGateOut = "";

    for (let attempt = 1; attempt <= maxAttempts && !passed; attempt += 1) {
      const tag = maxAttempts > 1 ? ` (attempt ${attempt}/${maxAttempts})` : "";
      record(`▶ phase ${index + 1}/${total} "${phase.name}"${tag}`);

      const instruction = attempt === 1 ? phase.instruction : gateFeedback(phase, lastGateOut);
      const run = await deps.agent(instruction, phase);
      if (!run.ok) {
        deps.saveState({ phaseIndex: index });
        record(`✗ "${phase.name}" — agent error: ${run.output}`);
        return { ok: false, completed, stoppedAt: phase.name, reason: `agent error: ${run.output}`, log };
      }

      if (phase.gate === undefined || phase.gate.length === 0) {
        passed = true;
        break;
      }

      const gateResult = await deps.gate(phase.gate, pipeline.workingDir);
      if (gateResult.code === 0) {
        record(`  ✔ gate passed: ${phase.gate.join(" ")}`);
        passed = true;
      } else {
        lastGateOut = gateResult.out.trim();
        record(`  ✖ gate failed (exit ${gateResult.code}): ${phase.gate.join(" ")}`);
      }
    }

    if (!passed) {
      deps.saveState({ phaseIndex: index }); // resume re-runs this phase
      record(`✗ "${phase.name}" — gate still failing after ${maxAttempts} attempt(s)`);
      return {
        ok: false,
        completed,
        stoppedAt: phase.name,
        reason: `gate failing after ${maxAttempts} attempt(s)`,
        log
      };
    }

    completed.push(phase.name);
    deps.saveState({ phaseIndex: index + 1 });
  }

  deps.clearState();
  record(`✓ pipeline "${pipeline.id}" complete (${completed.length}/${total} phase(s))`);
  return { ok: true, completed, log };
}

// ── Persistence ───────────────────────────────────────────────────────────────

function pipelinesDir(): string {
  return join(loopengHome(), "pipelines");
}

function specPath(id: string): string {
  return join(pipelinesDir(), `${id}.json`);
}

function statePath(id: string): string {
  return join(pipelinesDir(), `${id}.state.json`);
}

export function savePipeline(pipeline: Pipeline): void {
  mkdirSync(pipelinesDir(), { recursive: true, mode: 0o700 });
  writeJsonAtomic(specPath(pipeline.id), pipeline);
}

/**
 * Load a pipeline spec. Returns undefined when it doesn't exist OR can't be
 * validated against the given limits (corrupt/tampered, or over a tightened
 * limit) — never throws, so callers can't crash on a bad spec. Limits default
 * to DEFAULT_PIPELINE_LIMITS; the CLI passes config-derived limits so load is
 * consistent with how the pipeline was defined.
 */
export function loadPipeline(
  id: string,
  limits: PipelineLimits = DEFAULT_PIPELINE_LIMITS
): Pipeline | undefined {
  const raw = readJson<unknown>(specPath(id));
  if (raw === undefined) {
    return undefined;
  }
  try {
    return validatePipeline(raw, id, limits);
  } catch {
    return undefined;
  }
}

export function listPipelineIds(): string[] {
  if (!existsSync(pipelinesDir())) {
    return [];
  }
  return readdirSync(pipelinesDir(), { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith(".json") && !e.name.endsWith(".state.json"))
    .map((e) => e.name.slice(0, -".json".length))
    .sort();
}

export function loadPipelineState(id: string): PipelineRunState {
  return readJson<PipelineRunState>(statePath(id)) ?? { phaseIndex: 0 };
}

export function savePipelineState(id: string, state: PipelineRunState): void {
  mkdirSync(pipelinesDir(), { recursive: true, mode: 0o700 });
  writeJsonAtomic(statePath(id), state);
}

export function clearPipelineState(id: string): void {
  try {
    rmSync(statePath(id), { force: true });
  } catch {
    // already gone — fine
  }
}

/** Delete a pipeline spec and any run state. Returns false if it didn't exist. */
export function removePipeline(id: string): boolean {
  if (!existsSync(specPath(id))) {
    return false;
  }
  rmSync(specPath(id), { force: true });
  clearPipelineState(id);
  return true;
}

// ── Authoring & presentation (pure) ───────────────────────────────────────────

/** Ask one question and resolve the user's answer. Injected so the interactive
 *  collection logic is testable without a real terminal. */
export type Ask = (question: string) => Promise<string>;

/**
 * Collect a pipeline interactively: a description, then a phase at a time
 * (blank name to finish). Returns a validated Pipeline (throws on bad input).
 */
export async function collectPipeline(
  ask: Ask,
  id: string,
  limits: PipelineLimits = DEFAULT_PIPELINE_LIMITS
): Promise<Pipeline> {
  const description = (await ask("Description (optional): ")).trim();
  const phases: Record<string, unknown>[] = [];

  for (;;) {
    const name = (await ask(`Phase ${phases.length + 1} name (blank to finish): `)).trim();
    if (name === "") {
      break;
    }
    const instruction = (await ask("  Instruction for the agent: ")).trim();
    const gate = (await ask("  Gate command, e.g. `npm test` (blank for none): ")).trim();
    const attempts = (await ask("  Max attempts (blank = default): ")).trim();

    const phase: Record<string, unknown> = { name, instruction };
    if (gate !== "") {
      phase.gate = gate.split(/\s+/).filter(Boolean);
    }
    if (attempts !== "") {
      phase.maxAttempts = Number(attempts);
    }
    phases.push(phase);
  }

  return validatePipeline(
    { phases, ...(description !== "" ? { description } : {}) },
    id,
    limits
  );
}

// ── AI-assisted drafting (natural language → pipeline) ────────────────────────

/** Build the prompt that turns a plain-English description into a pipeline. */
export function draftPipelinePrompt(opts: {
  id: string;
  description: string;
  hints?: string;
  limits?: PipelineLimits;
}): string {
  const limits = opts.limits ?? DEFAULT_PIPELINE_LIMITS;
  const hints = opts.hints && opts.hints.trim() !== "" ? opts.hints.trim() : "(none provided)";
  return `You turn a developer's plain-English description of a workflow into a loopEng pipeline: an ordered list of phases an AI coding agent runs ONE AT A TIME.

Respond with ONLY a single JSON object, no prose:
{"description": string, "phases": [ {"name": string, "instruction": string, "gate"?: string[], "maxAttempts"?: number}, ... ]}

Rules:
- name: short snake_case (e.g. "implement", "test", "open_pr").
- instruction: one concrete, outcome-focused sentence telling the agent what to do in that phase.
- gate (optional): a real command as an argv array that must exit 0 before advancing, e.g. ["npm","test"]. It runs WITHOUT a shell — never use bash/sh/zsh/python/node with -c/-e, no pipes or &&. Omit gate when there is no automatic check.
- maxAttempts (optional): integer 1..${limits.maxAttempts}; use >1 for phases whose gate may need a few fix-and-retry cycles (e.g. tests).
- At most ${limits.maxPhases} phases. Prefer gates that match the project hints below.

Project hints (commands available in this repo):
${hints}

Description:
${opts.description}`;
}

/** Parse + validate a model's JSON response into a Pipeline. */
export function parseDraftedPipeline(
  llmText: string,
  id: string,
  limits: PipelineLimits = DEFAULT_PIPELINE_LIMITS
): Pipeline {
  let parsed: unknown;
  try {
    parsed = JSON.parse(extractFirstJsonObject(llmText));
  } catch {
    throw new PipelineError("the model did not return a JSON pipeline");
  }
  return validatePipeline(parsed, id, limits);
}

/** Human-readable, multi-line view of a pipeline for `pipelines show`. */
export function formatPipeline(pipeline: Pipeline): string[] {
  const head = pipeline.description ? `${pipeline.id} — ${pipeline.description}` : pipeline.id;
  const lines = [head];
  pipeline.phases.forEach((phase, i) => {
    const retries = phase.maxAttempts && phase.maxAttempts > 1 ? `  (up to ${phase.maxAttempts} attempts)` : "";
    lines.push(`  ${i + 1}. ${phase.name}${retries}`);
    lines.push(`     ↳ ${phase.instruction}`);
    lines.push(`     gate: ${phase.gate ? phase.gate.join(" ") : "—"}`);
  });
  return lines;
}
