import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  writeFileSync
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { LoopEngConfig, Proposal, ProposalStatus } from "./types.js";

const STATE_DIRS = ["digests", "proposals", "bundles", "registry", "log"] as const;
const APP_DIR_NAME = ".loopeng";
const APP_CONFIG_FILE = "config.json";
const DEFAULT_JSON_READ_MAX_BYTES = 8 * 1024 * 1024;

function defaultConfig(): LoopEngConfig {
  return {
    companion: "auto",
    dailyTokenCap: 100000,
    pollIntervalMin: 15,
    runnerCommand: "claude",
    runnerArgs: ["-p"],
    runnerTimeoutMs: 120_000,
    claudeProjectsDir: join(homedir(), ".claude", "projects"),
    codexSessionsDir: join(homedir(), ".codex", "sessions"),
    scope: "all",
    recentWindowHours: 4,
    scanMaxAttempts: 1,
    scanMaxDigestChars: 60000,
    eventsMaxBytes: 512 * 1024,
    eventsKeepLines: 1000,
    mcpToolStepTimeoutMs: 120_000,
    mcpToolMaxOutputBytes: 256 * 1024,
    dashboardBusyTickMs: 333,
    dashboardRefreshMs: 5000,
    watcherMarkerDebounceMs: 2000,
    pipelineMaxPhases: 30,
    pipelineMaxInstructionChars: 8000,
    pipelineMaxGateArgv: 32,
    pipelineMaxAttempts: 10,
    pipelineDefaultMaxAttempts: 1,
    pipelineGateTimeoutMs: 120_000,
    pipelineGateMaxOutputBytes: 1024 * 1024
  };
}

export function loopengHome(): string {
  return process.env.LOOPENG_HOME ?? join(homedir(), APP_DIR_NAME);
}

export function ensureDirs(): void {
  // loopEng state holds (redacted) session digests and generated loops — keep
  // the whole tree owner-only so other local users can't read it.
  for (const dir of STATE_DIRS) {
    const path = join(loopengHome(), dir);
    mkdirSync(path, { recursive: true, mode: 0o700 });
    chmodSync(path, 0o700);
  }
}

export function readJson<T>(path: string): T | undefined {
  if (!existsSync(path)) {
    return undefined;
  }

  try {
    const stat = statSync(path);
    if (!stat.isFile() || stat.size > jsonReadMaxBytes()) {
      return undefined;
    }
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return undefined;
  }
}

export function writeJsonAtomic(path: string, value: unknown): void {
  const dir = dirname(path);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodSync(dir, 0o700);
  const temporaryFilePath = `${path}.tmp`;
  writeFileSync(temporaryFilePath, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600
  });
  renameSync(temporaryFilePath, path);
  chmodSync(path, 0o600);
}

export function listProposals(): Proposal[] {
  ensureDirs();
  const proposalsDir = join(loopengHome(), "proposals");
  const proposals = readdirSync(proposalsDir, { withFileTypes: true })
    .filter((fileEntry) => fileEntry.isFile() && fileEntry.name.endsWith(".json"))
    .map((fileEntry) => readJson<Proposal>(join(proposalsDir, fileEntry.name)));

  return proposals.filter((proposal): proposal is Proposal => proposal !== undefined);
}

export function getProposal(id: string): Proposal | undefined {
  return readJson<Proposal>(proposalPath(id));
}

export function saveProposal(proposal: Proposal): void {
  ensureDirs();
  writeJsonAtomic(proposalPath(proposal.candidate.id), proposal);
}

export function setProposalStatus(id: string, status: ProposalStatus): void {
  const proposal = getProposal(id);
  if (proposal === undefined) {
    return;
  }

  saveProposal({ ...proposal, status });
}

export function addToRegistry(name: string, id: string): void {
  ensureDirs();
  const path = registryPath(name);
  const ids = readJson<string[]>(path) ?? [];

  if (!ids.includes(id)) {
    ids.push(id);
    writeJsonAtomic(path, ids);
  }
}

export function inRegistry(name: string, id: string): boolean {
  const ids = readJson<string[]>(registryPath(name)) ?? [];
  return ids.includes(id);
}

export function loadConfig(): LoopEngConfig {
  const configFilePath = join(loopengHome(), APP_CONFIG_FILE);
  const loadedConfig = readJson<Partial<LoopEngConfig>>(configFilePath) ?? {};
  return normalizeConfig({ ...defaultConfig(), ...loadedConfig });
}

export function runnerConfig(): { command: string; args: string[]; timeoutMs: number } {
  const config = loadConfig();
  return {
    command: process.env.LOOPENG_RUNNER_COMMAND ?? config.runnerCommand,
    args: envRunnerArgs() ?? config.runnerArgs,
    timeoutMs: envPositiveInteger("LOOPENG_RUNNER_TIMEOUT_MS") ?? config.runnerTimeoutMs
  };
}

export function transcriptDirs(): { claudeProjectsDir: string; codexSessionsDir: string } {
  const config = loadConfig();
  return {
    claudeProjectsDir: expandHome(
      process.env.LOOPENG_CLAUDE_PROJECTS_DIR ?? config.claudeProjectsDir
    ),
    codexSessionsDir: expandHome(process.env.LOOPENG_CODEX_SESSIONS_DIR ?? config.codexSessionsDir)
  };
}

// The active scope, with the LOOPENG_SCOPE env var winning over config for a
// quick one-off toggle (e.g. `LOOPENG_SCOPE=project npm run dev`).
export function watchScope(): "all" | "project" {
  const env = process.env.LOOPENG_SCOPE;
  if (env === "all" || env === "project") {
    return env;
  }
  return loadConfig().scope;
}

// The directory treated as "the project" when scope is "project": where loopEng
// was launched, overridable via LOOPENG_PROJECT.
export function scopeRoot(): string {
  return process.env.LOOPENG_PROJECT ?? process.cwd();
}

// Is a session's working directory within the active scope? Always true for
// "all"; for "project" it must equal the project root or sit beneath it.
export function cwdInScope(cwd: string): boolean {
  if (watchScope() === "all") {
    return true;
  }
  if (cwd === "") {
    return false;
  }
  const root = scopeRoot();
  const prefix = root.endsWith("/") ? root : `${root}/`;
  return cwd === root || cwd.startsWith(prefix);
}

const LOOP_ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

function proposalPath(proposalId: string): string {
  if (!LOOP_ID_RE.test(proposalId)) {
    throw new Error(
      `Invalid proposal ID "${proposalId}": must match /^[a-z0-9][a-z0-9-]{0,63}$/`
    );
  }
  return join(loopengHome(), "proposals", `${proposalId}.json`);
}

function registryPath(registryName: string): string {
  return join(loopengHome(), "registry", `${registryName}.json`);
}

function normalizeConfig(config: LoopEngConfig): LoopEngConfig {
  return {
    ...config,
    runnerCommand: stringOr(config.runnerCommand, "claude"),
    runnerArgs: stringArrayOr(config.runnerArgs, ["-p"]),
    runnerTimeoutMs: positiveIntegerOr(config.runnerTimeoutMs, 120_000),
    claudeProjectsDir: expandHome(
      stringOr(config.claudeProjectsDir, join(homedir(), ".claude", "projects"))
    ),
    codexSessionsDir: expandHome(
      stringOr(config.codexSessionsDir, join(homedir(), ".codex", "sessions"))
    ),
    eventsMaxBytes: positiveIntegerOr(config.eventsMaxBytes, 512 * 1024),
    eventsKeepLines: positiveIntegerOr(config.eventsKeepLines, 1000),
    mcpToolStepTimeoutMs: positiveIntegerOr(config.mcpToolStepTimeoutMs, 120_000),
    mcpToolMaxOutputBytes: positiveIntegerOr(config.mcpToolMaxOutputBytes, 256 * 1024),
    dashboardBusyTickMs: positiveIntegerOr(config.dashboardBusyTickMs, 333),
    dashboardRefreshMs: positiveIntegerOr(config.dashboardRefreshMs, 5000),
    watcherMarkerDebounceMs: positiveIntegerOr(config.watcherMarkerDebounceMs, 2000),
    pipelineMaxPhases: positiveIntegerOr(config.pipelineMaxPhases, 30),
    pipelineMaxInstructionChars: positiveIntegerOr(config.pipelineMaxInstructionChars, 8000),
    pipelineMaxGateArgv: positiveIntegerOr(config.pipelineMaxGateArgv, 32),
    pipelineMaxAttempts: positiveIntegerOr(config.pipelineMaxAttempts, 10),
    pipelineDefaultMaxAttempts: positiveIntegerOr(config.pipelineDefaultMaxAttempts, 1),
    pipelineGateTimeoutMs: positiveIntegerOr(config.pipelineGateTimeoutMs, 120_000),
    pipelineGateMaxOutputBytes: positiveIntegerOr(config.pipelineGateMaxOutputBytes, 1024 * 1024)
  };
}

function stringOr(value: unknown, fallback: string): string {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function stringArrayOr(value: unknown, fallback: string[]): string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string")
    ? value
    : fallback;
}

function positiveIntegerOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : fallback;
}

function envPositiveInteger(name: string): number | undefined {
  const raw = process.env[name];
  if (raw === undefined) {
    return undefined;
  }
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function jsonReadMaxBytes(): number {
  return envPositiveInteger("LOOPENG_JSON_READ_MAX_BYTES") ?? DEFAULT_JSON_READ_MAX_BYTES;
}

function envRunnerArgs(): string[] | undefined {
  const raw = process.env.LOOPENG_RUNNER_ARGS;
  if (raw === undefined) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed) && parsed.every((item) => typeof item === "string")) {
      return parsed;
    }
  } catch {
    // Fall back to whitespace splitting below.
  }

  const args = raw.split(/\s+/).filter((item) => item.length > 0);
  return args.length > 0 ? args : undefined;
}

function expandHome(path: string): string {
  if (path === "~") {
    return homedir();
  }
  return path.startsWith("~/") ? join(homedir(), path.slice(2)) : path;
}
