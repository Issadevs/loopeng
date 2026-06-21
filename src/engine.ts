import { spawn } from "node:child_process";
import { join } from "node:path";
import type { Candidate, CandidateType, ToolName } from "./types.js";
import { loadConfig, loopengHome, readJson, runnerConfig, writeJsonAtomic } from "./state.js";
import { extractFirstJsonObject } from "./shared/json.js";

export type InferenceExecutor = (promptText: string) => Promise<string>;
export class ProcessingError extends Error {}

export interface AnalysisInput {
  digests: string;
  knownSessionIds: string[];
  installed: string[];
  dismissed: string[];
  patternMemory: string;
  runner: InferenceExecutor;
}

export interface AnalysisOutput {
  skipped: boolean;
  candidates: Candidate[];
  watchlist: Candidate[];
  memoryUpdates: string[];
  warnings: string[];
}

const CANDIDATE_TYPES: CandidateType[] = [
  "recurring_task",
  "babysitting",
  "post_event",
  "retry_storm",
  "hygiene",
  "cross_tool"
];

const TOOL_NAMES: ToolName[] = ["claude-code", "codex"];
const TOKEN_ESTIMATE_CHARS_PER_TOKEN = 3;
const TOKEN_ESTIMATE_RESPONSE_RESERVE = 3000;
const LOOP_ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

const ANALYSIS_PROMPT = `You analyze a developer's terminal sessions to identify repetitive tasks that can be fully automated.

Candidate categories:
- recurring_task: Frequently repeated multi-step workflows.
- babysitting: Monitoring commands, logs, processes manually.
- post_event: Predictable follow-ups after builds/tests.
- retry_storm: Flaky operations requiring manual recovery.
- hygiene: Routine cleanup, formatting, or organization.
- cross_tool: Context transfers across various tools.

Quality bar:
Surface high-value workflows. Evidence must be seen in >=3 sessions. Include impactEstimate ("saves ~X min/week — because ...").

Rules:
- sessionIds MUST be strictly chosen from the known-session-id list.
- Do not repeat installed/dismissed ids.

Output schema:
Respond with a single JSON object:
{"candidates": [...], "watchlist": [...], "memoryUpdates": ["..."]}

Each candidate must have:
- id: lowercase slug matching /^[a-z0-9][a-z0-9-]{0,63}$/
- type: one of the candidate categories
- summary: string
- evidence: array of {sessionId: string, events: number[]}
- occurrences: number
- confidence: number between 0 and 1
- suggestedTool: claude-code or codex
- impactEstimate: string`;

interface RawEngineResponse {
  candidates: Candidate[];
  watchlist: Candidate[];
  memoryUpdates: string[];
}

type TokenLedger = Record<string, number>;

export async function runEngine(input: AnalysisInput): Promise<AnalysisOutput> {
  const prompt = buildPrompt(input);
  const estimate = estimateTokens(prompt);
  const spendPath = join(loopengHome(), "log", "spend.json");
  const ledger = readJson<TokenLedger>(spendPath) ?? {};
  const today = todayKey();

  if ((ledger[today] ?? 0) + estimate > loadConfig().dailyTokenCap) {
    return emptyOutput(true);
  }

  // Reserve the budget up front: failed attempts still consume real LLM calls,
  // so a perpetually-failing runner must not bypass the daily cap. Read →
  // check → write runs synchronously with no await in between, so within a
  // process it is atomic; writeJsonAtomic's rename keeps the file uncorrupted
  // even if two processes scan at once (worst case: a lost reservation, i.e. a
  // small budget overrun — never a crash or corrupt ledger).
  writeJsonAtomic(spendPath, { ...ledger, [today]: (ledger[today] ?? 0) + estimate });

  const raw = await callWithRetries(input.runner, prompt);
  return filterCandidates(raw, input);
}

export function defaultRunner(timeoutMs = runnerConfig().timeoutMs): InferenceExecutor {
  return (prompt: string) =>
    new Promise((resolve, reject) => {
      const runner = runnerConfig();
      const child = spawn(runner.command, runner.args, { stdio: ["pipe", "pipe", "pipe"] });
      let stdout = "";
      let stderr = "";
      let timedOut = false;
      const invocation = [runner.command, ...runner.args].join(" ");

      const timer = setTimeout(() => {
        timedOut = true;
        child.kill("SIGTERM");
        reject(new Error(`${invocation} timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => {
        stdout += chunk;
      });
      child.stderr.on("data", (chunk: string) => {
        stderr += chunk;
      });
      child.on("error", (err) => {
        clearTimeout(timer);
        reject(err);
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        if (timedOut) return;
        if (code === 0) {
          resolve(stdout);
        } else {
          reject(new Error(`${invocation} exited with code ${code}: ${stderr.trim()}`));
        }
      });

      child.stdin.end(prompt);
    });
}

function buildPrompt(input: AnalysisInput): string {
  return `${ANALYSIS_PROMPT}

Pattern memory:
${input.patternMemory}

Installed ids:
${JSON.stringify(input.installed)}

Dismissed ids:
${JSON.stringify(input.dismissed)}

Known session ids:
${JSON.stringify(input.knownSessionIds)}

Digests:
${input.digests}`;
}

function estimateTokens(prompt: string): number {
  return Math.ceil(prompt.length / TOKEN_ESTIMATE_CHARS_PER_TOKEN) + TOKEN_ESTIMATE_RESPONSE_RESERVE;
}

async function callWithRetries(runner: InferenceExecutor, prompt: string): Promise<RawEngineResponse> {
  let validationError = "";

  // How many times to call the LLM per scan (config `scanMaxAttempts`, default
  // 1 = one shot, no retry). Floored at 1 so a bad config can't disable scans.
  const maxAttempts = Math.max(1, loadConfig().scanMaxAttempts);

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const attemptPrompt =
      attempt === 1
        ? prompt
        : `${prompt}\n\nYour previous response was invalid: ${validationError}. Respond with ONLY the JSON object.`;
    const response = await runner(attemptPrompt);

    try {
      return validateResponse(JSON.parse(extractFirstJsonObject(response)));
    } catch (error) {
      validationError = error instanceof Error ? error.message : String(error);
    }
  }

  const tries = maxAttempts === 1 ? "1 attempt" : `${maxAttempts} attempts`;
  throw new ProcessingError(`LLM response stayed invalid after ${tries}: ${validationError}`);
}

function validateResponse(value: unknown): RawEngineResponse {
  if (!isRecord(value)) {
    throw new ProcessingError("response must be a JSON object");
  }

  const candidates = validateCandidateArray(value.candidates, "candidates");
  const watchlist = validateCandidateArray(value.watchlist, "watchlist");
  const memoryUpdates = validateStringArray(value.memoryUpdates, "memoryUpdates");

  return { candidates, watchlist, memoryUpdates };
}

function validateCandidateArray(value: unknown, field: string): Candidate[] {
  if (!Array.isArray(value)) {
    throw new ProcessingError(`${field} must be an array`);
  }

  return value.map((candidate, index) => validateCandidate(candidate, `${field}[${index}]`));
}

function validateCandidate(value: unknown, path: string): Candidate {
  if (!isRecord(value)) {
    throw new ProcessingError(`${path} must be an object`);
  }

  const id = requireLoopId(value.id, `${path}.id`);
  const type = requireCandidateType(value.type, `${path}.type`);
  const summary = requireString(value.summary, `${path}.summary`);
  const evidence = validateEvidenceArray(value.evidence, `${path}.evidence`);
  const occurrences = requirePositiveInteger(value.occurrences, `${path}.occurrences`);
  const confidence = requireConfidence(value.confidence, `${path}.confidence`);
  const suggestedTool = requireToolName(value.suggestedTool, `${path}.suggestedTool`);
  const impactEstimate = requireNonEmptyString(value.impactEstimate, `${path}.impactEstimate`);

  return {
    id,
    type,
    summary,
    evidence,
    occurrences,
    confidence,
    suggestedTool,
    impactEstimate
  };
}

function validateEvidenceArray(value: unknown, path: string): Candidate["evidence"] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new ProcessingError(`${path} must be a non-empty array`);
  }

  return value.map((evidence, index) => {
    if (!isRecord(evidence)) {
      throw new ProcessingError(`${path}[${index}] must be an object`);
    }

    const sessionId = requireString(evidence.sessionId, `${path}[${index}].sessionId`);
    const events = evidence.events;

    if (
      !Array.isArray(events) ||
      events.length === 0 ||
      !events.every((event) => Number.isInteger(event) && event >= 0)
    ) {
      throw new ProcessingError(`${path}[${index}].events must be a non-empty array of non-negative integers`);
    }

    return { sessionId, events };
  });
}

function validateStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    throw new ProcessingError(`${field} must be an array of strings`);
  }

  return value;
}

function filterCandidates(raw: RawEngineResponse, input: AnalysisInput): AnalysisOutput {
  const known = new Set(input.knownSessionIds);
  const ignored = new Set([...input.installed, ...input.dismissed]);
  const candidates: Candidate[] = [];
  const watchlist: Candidate[] = [];
  const warnings: string[] = [];

  for (const candidate of [...raw.candidates, ...raw.watchlist]) {
    if (ignored.has(candidate.id)) {
      continue;
    }

    const fabricatedSessionId = candidate.evidence.find((evidence) => !known.has(evidence.sessionId))?.sessionId;

    if (fabricatedSessionId !== undefined) {
      warnings.push(`Dropped candidate ${candidate.id}: evidence cites unknown sessionId ${fabricatedSessionId}`);
      continue;
    }

    if (candidate.confidence >= 0.75 && candidate.occurrences >= 3) {
      candidates.push(candidate);
    } else {
      watchlist.push(candidate);
    }
  }

  return {
    skipped: false,
    candidates,
    watchlist,
    memoryUpdates: raw.memoryUpdates,
    warnings
  };
}

function emptyOutput(skipped: boolean): AnalysisOutput {
  return {
    skipped,
    candidates: [],
    watchlist: [],
    memoryUpdates: [],
    warnings: []
  };
}

function todayKey(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireString(value: unknown, path: string): string {
  if (typeof value !== "string") {
    throw new ProcessingError(`${path} must be a string`);
  }

  return value;
}

function requireLoopId(value: unknown, path: string): string {
  const id = requireString(value, path);

  if (!LOOP_ID_RE.test(id)) {
    throw new ProcessingError(`${path} must match ${LOOP_ID_RE}`);
  }

  return id;
}

function requireNonEmptyString(value: unknown, path: string): string {
  const string = requireString(value, path);

  if (string.trim() === "") {
    throw new ProcessingError(`${path} must be non-empty`);
  }

  return string;
}

function requireCandidateType(value: unknown, path: string): CandidateType {
  if (typeof value !== "string" || !CANDIDATE_TYPES.includes(value as CandidateType)) {
    throw new ProcessingError(`${path} must be a known candidate type`);
  }

  return value as CandidateType;
}

function requireToolName(value: unknown, path: string): ToolName {
  if (typeof value !== "string" || !TOOL_NAMES.includes(value as ToolName)) {
    throw new ProcessingError(`${path} must be a known tool name`);
  }

  return value as ToolName;
}

function requirePositiveInteger(value: unknown, path: string): number {
  if (!Number.isInteger(value) || (value as number) <= 0) {
    throw new ProcessingError(`${path} must be a positive integer`);
  }

  return value as number;
}

function requireConfidence(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new ProcessingError(`${path} must be a number from 0 to 1`);
  }

  return value;
}
