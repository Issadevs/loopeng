/**
 * CLI glue for pipelines: turns the injected CliDeps (runner, output) and the
 * environment (config, stdin, real commands) into the pure orchestration core
 * in pipeline.ts. Keeping it out of cli.ts keeps each file focused.
 */
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";

import { CLI_BIN } from "./constants.js";
import { ensureDirs, loadConfig, readJson } from "./state.js";
import type { CliDeps } from "./actions.js";
import {
  clearPipelineState,
  collectPipeline,
  draftPipelinePrompt,
  formatPipeline,
  listPipelineIds,
  loadPipeline,
  loadPipelineState,
  parseDraftedPipeline,
  removePipeline,
  runPipeline,
  savePipeline,
  savePipelineState,
  validatePipeline,
  type Ask,
  type Pipeline,
  type PipelineDeps,
  type PipelineLimits
} from "./pipeline.js";

// ── shared helpers ─────────────────────────────────────────────────────────--

// Pipeline validation limits, sourced from config so everything is tunable.
export function pipelineLimits(): PipelineLimits {
  const c = loadConfig();
  return {
    maxPhases: c.pipelineMaxPhases,
    maxInstructionChars: c.pipelineMaxInstructionChars,
    maxGateArgv: c.pipelineMaxGateArgv,
    maxAttempts: c.pipelineMaxAttempts,
    defaultMaxAttempts: c.pipelineDefaultMaxAttempts
  };
}

// Run a gate command with execFile (no shell): code 0 = pass.
function execGate(argv: string[], cwd: string | undefined): Promise<{ code: number; out: string }> {
  const [cmd, ...rest] = argv;
  const c = loadConfig();
  return new Promise((resolve) => {
    execFile(
      cmd ?? "",
      rest,
      { cwd, timeout: c.pipelineGateTimeoutMs, maxBuffer: c.pipelineGateMaxOutputBytes },
      (error, stdout, stderr) => {
        const out = `${stdout ?? ""}${stderr ?? ""}`;
        if (error) {
          const code =
            typeof (error as NodeJS.ErrnoException).code === "number"
              ? ((error as unknown as { code: number }).code as number)
              : 1;
          resolve({ code: code === 0 ? 1 : code, out: out || error.message });
        } else {
          resolve({ code: 0, out });
        }
      }
    );
  });
}

function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => (data += chunk));
    process.stdin.on("end", () => resolve(data));
    process.stdin.on("error", reject);
  });
}

// Wrap readline so the interactive collection runs against a real terminal.
async function withReadline<T>(run: (ask: Ask) => Promise<T>): Promise<T> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const ask: Ask = (question) => new Promise((resolve) => rl.question(question, resolve));
  try {
    return await run(ask);
  } finally {
    rl.close();
  }
}

const firstLine = (text: string): string => {
  const line = text.split("\n", 1)[0] ?? "";
  return line.length > 72 ? `${line.slice(0, 71)}…` : line;
};

// Surface the project's own commands so the model proposes gates that actually
// exist here (e.g. `npm test`) instead of guessing.
function detectProjectHints(cwd: string): string {
  const pkg = readJson<{ scripts?: Record<string, string> }>(join(cwd, "package.json"));
  const scripts = pkg?.scripts ?? {};
  const found = ["test", "build", "lint", "typecheck", "check"]
    .filter((name) => typeof scripts[name] === "string")
    .map((name) => `- ${name}: \`npm run ${name}\``);
  return found.length > 0 ? `package.json scripts:\n${found.join("\n")}` : "";
}

// ── define ────────────────────────────────────────────────────────────────--

// Draft a pipeline from a plain-English description via the agent, then (in a
// real terminal) confirm before saving.
async function defineFromDescription(deps: CliDeps, id: string, description: string): Promise<void> {
  let draft: Pipeline;
  try {
    const prompt = draftPipelinePrompt({
      id,
      description,
      hints: detectProjectHints(process.cwd()),
      limits: pipelineLimits()
    });
    deps.out("drafting a pipeline from your description…");
    draft = parseDraftedPipeline(await deps.runner(prompt), id, pipelineLimits());
  } catch (e) {
    deps.out(`✗ could not draft "${id}": ${e instanceof Error ? e.message : String(e)}`);
    return;
  }

  for (const line of formatPipeline(draft)) {
    deps.out(line);
  }

  if (process.stdin.isTTY === true) {
    const answer = (await withReadline((ask) => ask("Keep this pipeline? [y]es / [n]o: "))).trim();
    if (!/^y/i.test(answer)) {
      deps.out("not saved — describe it differently, or tweak the JSON and use --file:");
      deps.out(JSON.stringify({ description: draft.description, phases: draft.phases }, null, 2));
      return;
    }
  }

  savePipeline(draft);
  clearPipelineState(id);
  deps.out(`✓ defined "${id}" — ${draft.phases.map((p) => p.name).join(" → ")}`);
}

export async function defineAction(
  deps: CliDeps,
  id: string,
  opts: { file?: string; describe?: string }
): Promise<void> {
  ensureDirs();

  if (opts.describe !== undefined && opts.describe.trim() !== "") {
    await defineFromDescription(deps, id, opts.describe);
    return;
  }

  let pipeline: Pipeline;
  try {
    if (opts.file === undefined && process.stdin.isTTY === true) {
      // Interactive: walk the user through the phases.
      deps.out(`Defining pipeline "${id}" — answer a few questions (Ctrl-C to abort).`);
      pipeline = await withReadline((ask) => collectPipeline(ask, id, pipelineLimits()));
    } else {
      const raw =
        opts.file !== undefined ? readFileSync(opts.file, "utf8") : await readStdin();
      pipeline = validatePipeline(JSON.parse(raw), id, pipelineLimits());
    }
  } catch (e) {
    deps.out(`✗ could not define "${id}": ${e instanceof Error ? e.message : String(e)}`);
    return;
  }

  if (pipeline.phases.length === 0) {
    deps.out("✗ a pipeline needs at least one phase");
    return;
  }

  savePipeline(pipeline);
  clearPipelineState(id); // a freshly (re)defined pipeline starts from the top
  deps.out(`✓ defined "${id}" — ${pipeline.phases.map((p) => p.name).join(" → ")}`);
}

// ── run ───────────────────────────────────────────────────────────────────--

export async function runPipelineAction(
  deps: CliDeps,
  id: string,
  opts: { restart?: boolean; dryRun?: boolean }
): Promise<void> {
  const pipeline = loadPipeline(id, pipelineLimits());
  if (pipeline === undefined) {
    deps.out(`✗ no pipeline "${id}" — define one: ${CLI_BIN} define ${id}`);
    return;
  }

  if (opts.dryRun === true) {
    deps.out(`dry run of "${id}" — nothing is executed:`);
    await runPipeline(pipeline, dryRunDeps(deps), { phaseIndex: 0 });
    return;
  }

  if (opts.restart === true) {
    clearPipelineState(id);
  }
  await runPipeline(pipeline, liveDeps(deps, id), loadPipelineState(id));
}

function liveDeps(deps: CliDeps, id: string): PipelineDeps {
  return {
    agent: async (instruction) => {
      try {
        return { ok: true, output: await deps.runner(instruction) };
      } catch (e) {
        return { ok: false, output: e instanceof Error ? e.message : String(e) };
      }
    },
    gate: (argv, cwd) => execGate(argv, cwd),
    saveState: (state) => savePipelineState(id, state),
    clearState: () => clearPipelineState(id),
    log: (line) => {
      deps.out(line);
      if (line.startsWith("✗")) {
        deps.out(`  fix the above, then resume with: ${CLI_BIN} run ${id}`);
      }
    }
  };
}

// Walk every phase without calling the agent or running gates.
function dryRunDeps(deps: CliDeps): PipelineDeps {
  return {
    agent: async (instruction) => {
      deps.out(`   would ask the agent: ${firstLine(instruction)}`);
      return { ok: true, output: "" };
    },
    gate: async (argv) => {
      deps.out(`   would check gate: ${argv.join(" ")}`);
      return { code: 0, out: "" };
    },
    saveState: () => {},
    clearState: () => {},
    log: (line) => deps.out(line)
  };
}

// ── list / show / forget ──────────────────────────────────────────────────--

export function listPipelinesAction(deps: CliDeps): void {
  const ids = listPipelineIds();
  if (ids.length === 0) {
    deps.out(`no pipelines yet — define one: ${CLI_BIN} define <id>`);
    return;
  }
  for (const id of ids) {
    const pipeline = loadPipeline(id, pipelineLimits());
    const phases = pipeline ? pipeline.phases.map((p) => p.name).join(" → ") : "(unreadable)";
    const at = loadPipelineState(id).phaseIndex;
    const resume = at > 0 ? `  [resumes at phase ${at + 1}]` : "";
    deps.out(`${id}: ${phases}${resume}`);
  }
}

export function showPipelineAction(deps: CliDeps, id: string): void {
  const pipeline = loadPipeline(id, pipelineLimits());
  if (pipeline === undefined) {
    deps.out(`✗ no pipeline "${id}"`);
    return;
  }
  for (const line of formatPipeline(pipeline)) {
    deps.out(line);
  }
  const at = loadPipelineState(id).phaseIndex;
  if (at > 0) {
    deps.out(`(stopped — ${CLI_BIN} run ${id} resumes at phase ${at + 1})`);
  }
}

export function forgetPipelineAction(deps: CliDeps, id: string): void {
  deps.out(removePipeline(id) ? `✓ removed pipeline "${id}"` : `✗ no pipeline "${id}"`);
}
