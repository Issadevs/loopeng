/**
 * A loopeng tool spec is the machine-runnable counterpart of a loop.md: it turns
 * a manual terminal workflow into a callable MCP tool. Where loop.md is prose
 * instructions for an agent to follow, a ToolSpec is a parameterised sequence
 * of argv commands that the loopeng-tools MCP server executes directly — so a
 * future agent can invoke the workflow as a single tool call.
 *
 * Safety model: commands are NEVER run through a shell. Each step is an argv
 * array executed via execFile, so user-supplied parameter values cannot inject
 * extra commands (no `;`, `|`, `$()`, backticks are interpreted). Parameter
 * values are substituted literally into argv tokens.
 */

export type ToolParamType = "string" | "number" | "boolean";

export interface ToolParam {
  name: string; // /^[a-z][a-z0-9_]*$/
  type: ToolParamType;
  description: string;
  required: boolean;
}

export interface ToolStep {
  argv: string[]; // non-empty; tokens may contain ${param} placeholders
}

export interface ToolSpec {
  loopId: string;
  name: string; // MCP tool name: /^[a-z][a-z0-9_]{2,63}$/
  description: string;
  parameters: ToolParam[];
  steps: ToolStep[];
  workingDir?: string;
}

export class ToolSpecError extends Error {}

const PARAM_TYPES: ToolParamType[] = ["string", "number", "boolean"];
const PARAM_NAME_RE = /^[a-z][a-z0-9_]*$/;
const TOOL_NAME_RE = /^[a-z][a-z0-9_]{2,63}$/;
const PLACEHOLDER_RE = /\$\{([a-z][a-z0-9_]*)\}/g;

// Defensive caps so a malformed spec can never produce an unbounded command.
const MAX_STEPS = 20;
const MAX_ARGV = 64;
const MAX_TOKEN_LEN = 4096;

// Programs that re-introduce arbitrary execution (shells / interpreters that
// run inline code from their arguments). The no-shell execFile model only
// blocks injection through *parameters* — it does nothing against a malicious
// *base command*. A generated spec naming one of these as argv[0] is rejected,
// so an LLM (or a prompt-injected digest) can't synthesise `bash -c …`.
const BLOCKED_COMMANDS = new Set([
  "sh", "bash", "zsh", "fish", "dash", "ksh", "csh", "tcsh", "ash",
  "env", "eval", "exec", "command", "nohup", "time", "xargs", "watch", "nice",
  "python", "python2", "python3", "node", "deno", "bun", "ruby", "perl",
  "php", "lua", "groovy", "osascript", "powershell", "pwsh"
]);

// Map an argv[0] to a comparable program name: drop any directory and a Windows
// executable suffix so `/bin/bash` and `bash.exe` both resolve to `bash`.
function commandBasename(command: string): string {
  const base = command.split(/[\\/]/).pop() ?? command;
  return base.toLowerCase().replace(/\.(exe|cmd|bat|ps1)$/, "");
}

// Is this argv[0] a shell/interpreter that would re-introduce arbitrary code?
// Shared so anything that runs a user/LLM-provided command (tool steps,
// pipeline gates) applies the same guard.
export function isBlockedCommand(command: string): boolean {
  return BLOCKED_COMMANDS.has(commandBasename(command));
}

// ── Validation ───────────────────────────────────────────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireString(value: unknown, path: string): string {
  if (typeof value !== "string") {
    throw new ToolSpecError(`${path} must be a string`);
  }
  return value;
}

function requireNonEmptyString(value: unknown, path: string): string {
  const s = requireString(value, path);
  if (s.trim() === "") {
    throw new ToolSpecError(`${path} must be non-empty`);
  }
  return s;
}

/** Collect the placeholder names referenced anywhere inside an argv token. */
function placeholdersIn(token: string): string[] {
  const names: string[] = [];
  for (const match of token.matchAll(PLACEHOLDER_RE)) {
    names.push(match[1]);
  }
  return names;
}

function validateParam(value: unknown, path: string): ToolParam {
  if (!isRecord(value)) {
    throw new ToolSpecError(`${path} must be an object`);
  }
  const name = requireString(value.name, `${path}.name`);
  if (!PARAM_NAME_RE.test(name)) {
    throw new ToolSpecError(`${path}.name must match ${PARAM_NAME_RE}`);
  }
  const type = value.type;
  if (typeof type !== "string" || !PARAM_TYPES.includes(type as ToolParamType)) {
    throw new ToolSpecError(`${path}.type must be one of ${PARAM_TYPES.join(", ")}`);
  }
  const description = requireNonEmptyString(value.description, `${path}.description`);
  if (typeof value.required !== "boolean") {
    throw new ToolSpecError(`${path}.required must be a boolean`);
  }
  return { name, type: type as ToolParamType, description, required: value.required };
}

function validateStep(value: unknown, path: string, params: Map<string, ToolParam>): ToolStep {
  if (!isRecord(value)) {
    throw new ToolSpecError(`${path} must be an object`);
  }
  const argv = value.argv;
  if (!Array.isArray(argv) || argv.length === 0) {
    throw new ToolSpecError(`${path}.argv must be a non-empty array`);
  }
  if (argv.length > MAX_ARGV) {
    throw new ToolSpecError(`${path}.argv must have at most ${MAX_ARGV} tokens`);
  }

  argv.forEach((token, index) => {
    if (typeof token !== "string" || token === "") {
      throw new ToolSpecError(`${path}.argv[${index}] must be a non-empty string`);
    }
    if (token.length > MAX_TOKEN_LEN) {
      throw new ToolSpecError(`${path}.argv[${index}] exceeds ${MAX_TOKEN_LEN} chars`);
    }
    // The command itself (argv[0]) must be a static program name — never
    // assembled from a parameter, and never a shell/interpreter that would let
    // arbitrary code back in, so a caller can never choose what runs.
    const refs = placeholdersIn(token);
    if (index === 0) {
      if (refs.length > 0) {
        throw new ToolSpecError(`${path}.argv[0] (the command) must not contain a \${placeholder}`);
      }
      if (BLOCKED_COMMANDS.has(commandBasename(token))) {
        throw new ToolSpecError(
          `${path}.argv[0] command "${token}" is not allowed — shells and interpreters that run inline code are blocked`,
        );
      }
    }
    for (const ref of refs) {
      const param = params.get(ref);
      if (param === undefined) {
        throw new ToolSpecError(`${path}.argv[${index}] references unknown parameter "${ref}"`);
      }
      // Referenced params must be required so rendering is never ambiguous
      // about what to do with a missing optional value.
      if (!param.required) {
        throw new ToolSpecError(
          `${path}.argv[${index}] references optional parameter "${ref}" — referenced parameters must be required`,
        );
      }
    }
  });

  return { argv: argv as string[] };
}

/**
 * Strictly validate an untrusted value into a ToolSpec. `loopId` is supplied by
 * the caller (never trusted from the LLM) so generated names cannot collide
 * with or impersonate another loop's id.
 */
export function validateToolSpec(value: unknown, loopId: string): ToolSpec {
  if (!isRecord(value)) {
    throw new ToolSpecError("tool spec must be a JSON object");
  }

  const name = requireString(value.name, "name");
  if (!TOOL_NAME_RE.test(name)) {
    throw new ToolSpecError(`name must match ${TOOL_NAME_RE} (snake_case, 3-64 chars)`);
  }
  const description = requireNonEmptyString(value.description, "description");

  if (!Array.isArray(value.parameters)) {
    throw new ToolSpecError("parameters must be an array");
  }
  const parameters = value.parameters.map((p, i) => validateParam(p, `parameters[${i}]`));
  const paramMap = new Map<string, ToolParam>();
  for (const p of parameters) {
    if (paramMap.has(p.name)) {
      throw new ToolSpecError(`duplicate parameter name "${p.name}"`);
    }
    paramMap.set(p.name, p);
  }

  if (!Array.isArray(value.steps) || value.steps.length === 0) {
    throw new ToolSpecError("steps must be a non-empty array");
  }
  if (value.steps.length > MAX_STEPS) {
    throw new ToolSpecError(`steps must have at most ${MAX_STEPS} entries`);
  }
  const steps = value.steps.map((s, i) => validateStep(s, `steps[${i}]`, paramMap));

  const spec: ToolSpec = { loopId, name, description, parameters, steps };

  if (value.workingDir !== undefined) {
    spec.workingDir = requireNonEmptyString(value.workingDir, "workingDir");
  }

  return spec;
}

// ── Rendering ────────────────────────────────────────────────────────────────

export type ToolArgs = Record<string, string | number | boolean>;

function coerceArg(param: ToolParam, raw: unknown): string {
  if (raw === undefined || raw === null) {
    throw new ToolSpecError(`missing required argument "${param.name}"`);
  }
  switch (param.type) {
    case "number":
      if (typeof raw !== "number" || !Number.isFinite(raw)) {
        throw new ToolSpecError(`argument "${param.name}" must be a finite number`);
      }
      return String(raw);
    case "boolean":
      if (typeof raw !== "boolean") {
        throw new ToolSpecError(`argument "${param.name}" must be a boolean`);
      }
      return raw ? "true" : "false";
    case "string":
    default: {
      if (typeof raw !== "string") {
        throw new ToolSpecError(`argument "${param.name}" must be a string`);
      }
      return raw;
    }
  }
}

/**
 * Resolve every step's argv against the supplied args. Each `${param}`
 * occurrence is replaced literally by the (validated, stringified) argument.
 * Throws on a missing/ill-typed required argument. The returned argv arrays are
 * safe to hand to execFile — values are never shell-interpreted.
 */
export function renderSteps(spec: ToolSpec, args: ToolArgs): string[][] {
  const byName = new Map(spec.parameters.map((p) => [p.name, p] as const));
  const resolved = new Map<string, string>();

  return spec.steps.map((step) =>
    step.argv.map((token) =>
      token.replace(PLACEHOLDER_RE, (_match, name: string) => {
        let value = resolved.get(name);
        if (value === undefined) {
          const param = byName.get(name);
          // validateToolSpec guarantees referenced params exist; defensive only.
          if (param === undefined) {
            throw new ToolSpecError(`unknown parameter "${name}"`);
          }
          value = coerceArg(param, args[name]);
          resolved.set(name, value);
        }
        return value;
      }),
    ),
  );
}

// ── Execution ────────────────────────────────────────────────────────────────

export type StepExec = (
  cmd: string,
  args: string[],
  opts: { cwd?: string },
) => Promise<{ code: number; out: string }>;

export interface StepResult {
  argv: string[];
  code: number;
  out: string;
}

export interface ExecuteResult {
  ok: boolean;
  results: StepResult[];
  output: string; // human-readable transcript of every step
}

/**
 * Execute a tool spec's steps in order, stopping at the first non-zero exit.
 * The injected `exec` must run argv WITHOUT a shell (execFile semantics) — this
 * is what keeps parameter substitution injection-proof. Returns a transcript
 * plus per-step results; `ok` is false if any step exited non-zero or threw.
 */
export async function executeToolSpec(
  spec: ToolSpec,
  args: ToolArgs,
  exec: StepExec,
): Promise<ExecuteResult> {
  const rendered = renderSteps(spec, args);
  const results: StepResult[] = [];

  for (const argv of rendered) {
    const [cmd, ...rest] = argv;
    let code: number;
    let out: string;
    try {
      const r = await exec(cmd, rest, { cwd: spec.workingDir });
      code = r.code;
      out = r.out;
    } catch (e) {
      code = 127;
      out = e instanceof Error ? e.message : String(e);
    }
    results.push({ argv, code, out });
    if (code !== 0) {
      break; // a failed step aborts the workflow; later steps assume success
    }
  }

  const ok = results.length === rendered.length && results.every((r) => r.code === 0);
  const output = results
    .map((r) => `$ ${r.argv.join(" ")}\n${r.out.trimEnd()} (exit ${r.code})`)
    .join("\n\n");

  return { ok, results, output };
}
