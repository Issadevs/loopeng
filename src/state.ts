import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  writeFileSync
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { LoopEngConfig, Proposal, ProposalStatus } from "./types.js";

const STATE_DIRS = ["digests", "proposals", "bundles", "registry", "log"] as const;
const APP_DIR_NAME = ".loopeng";
const APP_CONFIG_FILE = "config.json";

const DEFAULT_CONFIG: LoopEngConfig = {
  companion: "auto",
  dailyTokenCap: 100000,
  pollIntervalMin: 15,
  scope: "all",
  recentWindowHours: 4,
  scanMaxAttempts: 1,
  scanMaxDigestChars: 60000
};

export function loopengHome(): string {
  return process.env.LOOPENG_HOME ?? join(homedir(), APP_DIR_NAME);
}

export function ensureDirs(): void {
  for (const dir of STATE_DIRS) {
    mkdirSync(join(loopengHome(), dir), { recursive: true });
  }
}

export function readJson<T>(path: string): T | undefined {
  if (!existsSync(path)) {
    return undefined;
  }

  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return undefined;
  }
}

export function writeJsonAtomic(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  const temporaryFilePath = `${path}.tmp`;
  writeFileSync(temporaryFilePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  renameSync(temporaryFilePath, path);
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
  return { ...DEFAULT_CONFIG, ...loadedConfig };
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
