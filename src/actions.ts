import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

import type { Candidate, Proposal } from "./types.js";
import {
  addToRegistry,
  cwdInScope,
  ensureDirs,
  getProposal,
  inRegistry,
  listProposals,
  loadConfig,
  loopengHome,
  readJson,
  saveProposal,
  setProposalStatus,
  writeJsonAtomic,
} from "./state.js";
import { compactDigestForPrompt, parseDigestHeader } from "./digester.js";
import { runEngine, type InferenceExecutor as LlmRunner } from "./engine.js";
import { appendEvent } from "./events.js";
import { generateBundle } from "./generator.js";
import { generateToolSpec } from "./toolgen.js";
import { resolveEvidence } from "./evidence.js";
import { type InstallContext, uninstallLoop, validateLoopId } from "./installers/shared.js";
import { installClaudeCodeLoop } from "./installers/claude-code.js";
import { installCodexLoop } from "./installers/codex.js";
import { VOICE } from "./companion/voice.js";

// ── Dependency injection ─────────────────────────────────────────────────────

export type ActionResult = { ok: true } | { ok: false; reason: string };

export interface CliDeps {
  runner: LlmRunner;
  exec: (cmd: string, args: string[]) => Promise<{ code: number; out: string }>;
  now: () => string;
  homedir: () => string;
  out: (line: string) => void;
}

// ── Constants ────────────────────────────────────────────────────────────────

const CLAUDE_CONFIG_DIR = ".claude";
const CLAUDE_SETTINGS_FILE = "settings.json";
const MACOS_LAUNCH_DIR = "Library";
const MACOS_AGENTS_DIR = "LaunchAgents";
const DIGEST_HEADER_READ_BYTES = 8192;

// ── Path helpers ─────────────────────────────────────────────────────────────

export function claudeSettingsPath(deps: CliDeps): string {
  return join(deps.homedir(), CLAUDE_CONFIG_DIR, CLAUDE_SETTINGS_FILE);
}

export function launchAgentsDir(deps: CliDeps): string {
  return join(deps.homedir(), MACOS_LAUNCH_DIR, MACOS_AGENTS_DIR);
}

export function installContext(deps: CliDeps): InstallContext {
  return {
    claudeSettingsPath: claudeSettingsPath(deps),
    launchAgentsDir: launchAgentsDir(deps),
    exec: deps.exec,
  };
}

function bundlesDir(): string {
  return join(loopengHome(), "bundles");
}

export function bundleDirFor(proposal: Proposal | undefined, proposalId: string): string {
  return proposal?.bundleDir ?? join(bundlesDir(), proposalId);
}

function nowMs(deps: CliDeps): number {
  return new Date(deps.now()).getTime();
}

// ── scan helpers ─────────────────────────────────────────────────────────────

function analyzedPath(): string {
  return join(loopengHome(), "registry", "analyzed.json");
}

function readDigestPrefix(path: string, maxChars: number): string {
  const fd = openSync(path, "r");
  try {
    const maxBytes = Math.max(1, maxChars, DIGEST_HEADER_READ_BYTES);
    const buffer = Buffer.alloc(maxBytes);
    const bytesRead = readSync(fd, buffer, 0, buffer.length, 0);
    return buffer.toString("utf8", 0, bytesRead);
  } finally {
    closeSync(fd);
  }
}

// Gather the scan payload. Only digests for sessions not yet analyzed are sent
// (oldest filename first, capped to MAX_SCAN_DIGEST_CHARS), so we never re-pay
// for the whole history every scan. `knownSessionIds` stays the full set on
// disk — it is the whitelist the engine uses to reject evidence citing a
// session it has never seen, so it must not be narrowed to the payload.
// `pending` is the ids actually included, to mark analyzed after a good scan.
function readDigests(): { digests: string; knownSessionIds: string[]; pending: string[] } {
  const dir = join(loopengHome(), "digests");
  if (!existsSync(dir)) {
    return { digests: "", knownSessionIds: [], pending: [] };
  }

  const names = readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".txt"))
    .map((entry) => entry.name)
    .sort();

  const knownSessionIds = names.map((name) => name.slice(0, -".txt".length));
  const analyzed = new Set(readJson<string[]>(analyzedPath()) ?? []);

  // Cap how much digest text one scan sends to the engine (config
  // `scanMaxDigestChars`, default 60k chars ≈ ~15k tokens), so a large backlog
  // is processed across several smaller, faster, cheaper scans.
  const maxChars = Math.max(1, loadConfig().scanMaxDigestChars);

  const chunks: string[] = [];
  const pending: string[] = [];
  let size = 0;
  for (const name of names) {
    const id = name.slice(0, -".txt".length);
    if (analyzed.has(id)) {
      continue;
    }
    const raw = readDigestPrefix(join(dir, name), maxChars);
    // Respect the active scope: when watching a single project, don't analyze
    // (or pay for) sessions from other projects.
    const header = parseDigestHeader(raw.split("\n", 1)[0] ?? "");
    if (!cwdInScope(header.cwd)) {
      continue;
    }
    // Truncate a single oversized digest to the per-scan cap. Otherwise a
    // digest larger than the daily token budget would be skipped by the engine
    // on every scan, never marked analyzed, and would wedge the whole queue.
    const text = raw.length > maxChars ? raw.slice(0, maxChars) : raw;
    // Always include at least one digest so a session still makes progress
    // rather than stalling the queue forever.
    if (pending.length > 0 && size + text.length > maxChars) {
      break;
    }
    chunks.push(text);
    pending.push(id);
    size += text.length;
  }

  return { digests: chunks.join("\n"), knownSessionIds, pending };
}

// Cap the replayed pattern memory so scan prompts stay bounded over time.
const PATTERN_MEMORY_MAX_LINES = 200;

function patternMemoryPath(): string {
  return join(loopengHome(), "log", "pattern-memory.txt");
}

// ── scan ─────────────────────────────────────────────────────────────────────

export async function scanAction(deps: CliDeps): Promise<ActionResult> {
  try {
    ensureDirs();
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    deps.out(`✗ scan failed: could not prepare loopeng dirs: ${reason}`);
    return { ok: false, reason: `failed to ensure loopeng dirs: ${reason}` };
  }

  const { digests, knownSessionIds, pending } = readDigests();

  // Nothing new since the last scan — don't spend a single token re-analyzing
  // the same history.
  if (pending.length === 0) {
    appendEvent("scan", "scan skipped — no new sessions", deps.now());
    deps.out("nothing new to scan — all sessions already analyzed");
    return { ok: true };
  }

  const installed = readJson<string[]>(join(loopengHome(), "registry", "installed.json")) ?? [];
  const dismissed = readJson<string[]>(join(loopengHome(), "registry", "dismissed.json")) ?? [];

  const memPath = patternMemoryPath();
  const patternMemory = existsSync(memPath) ? readFileSync(memPath, "utf8") : "";

  let output;
  try {
    output = await runEngine({
      // Trim timestamps from the payload to cut scan tokens (~30%) with no loss
      // of signal — the model cites evidence by event index, not by time.
      digests: compactDigestForPrompt(digests),
      // Keep the FULL on-disk id set as the evidence whitelist: a recurring
      // pattern accumulates across incremental scans, so a candidate may
      // legitimately cite earlier sessions not in this scan's payload. Narrowing
      // it to the payload would drop those candidates entirely.
      knownSessionIds,
      installed,
      dismissed,
      patternMemory,
      runner: deps.runner,
    });
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    appendEvent("scan", `scan failed: ${reason}`, deps.now());
    deps.out(`✗ scan failed: ${reason}`);
    return { ok: false, reason: `scan engine error: ${reason}` };
  }

  if (output.skipped) {
    // Distinguish "no budget left at all today" from "this particular scan is
    // too big for what's left" — the old single message read as the former even
    // when most of the budget was unused.
    const today = deps.now().slice(0, 10);
    const used = (readJson<Record<string, number>>(join(loopengHome(), "log", "spend.json")) ?? {})[today] ?? 0;
    const cap = loadConfig().dailyTokenCap;
    const msg =
      used >= cap
        ? `daily token budget reached (${used}/${cap})`
        : `this scan exceeds today's remaining token budget (${used}/${cap} used) — lower scanMaxDigestChars or wait for tomorrow`;
    appendEvent("scan", `scan skipped — ${msg}`, deps.now());
    deps.out(msg);
    return { ok: true };
  }

  // The engine ran on these sessions, so don't send them again next scan.
  // Prune ids whose digest no longer exists (deleted/rotated) so the ledger
  // tracks the live digest set instead of growing forever.
  const onDisk = new Set(knownSessionIds);
  const analyzed = readJson<string[]>(analyzedPath()) ?? [];
  const nextAnalyzed = [...new Set([...analyzed, ...pending])].filter((id) => onDisk.has(id));
  writeJsonAtomic(analyzedPath(), nextAnalyzed);

  let saved = 0;
  for (const candidate of output.candidates) {
    if (getProposal(candidate.id) !== undefined) {
      continue;
    }
    if (inRegistry("installed", candidate.id) || inRegistry("dismissed", candidate.id)) {
      continue;
    }
    saveProposal({ candidate, status: "pending", createdAt: deps.now() });
    saved += 1;
  }

  appendEvent("scan", `scan complete: ${saved} new proposal(s)`, deps.now());

  if (output.memoryUpdates.length > 0) {
    const existing = existsSync(memPath) ? readFileSync(memPath, "utf8") : "";
    const merged = (existing + output.memoryUpdates.map((line) => `${line}\n`).join(""))
      .split("\n")
      .filter((line) => line.trim().length > 0);
    // Pattern memory is replayed into every scan prompt, so keep only the most
    // recent lines — otherwise it grows without bound and each scan gets bigger
    // (and pricier) until it hits the token budget.
    const kept = merged.slice(-PATTERN_MEMORY_MAX_LINES);
    mkdirSync(join(loopengHome(), "log"), { recursive: true });
    writeFileSync(memPath, kept.length > 0 ? `${kept.join("\n")}\n` : "", { encoding: "utf8", mode: 0o600 });
  }

  deps.out(saved > 0 ? VOICE.proposalNudge(saved) : VOICE.noProposals());
  for (const warning of output.warnings) {
    deps.out(`⚠ ${warning}`);
  }
  return { ok: true };
}

// ── approve ──────────────────────────────────────────────────────────────────

export async function approveAction(deps: CliDeps, proposal: Proposal): Promise<ActionResult> {
  const candidate: Candidate = proposal.candidate;
  let result;
  try {
    result = await generateBundle(candidate, {
      runner: deps.runner,
      bundlesDir: bundlesDir(),
      now: deps.now(),
    });
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    appendEvent("error", `bundle generation threw for ${candidate.id}: ${reason}`, deps.now());
    return { ok: false, reason };
  }

  if (!result.ok) {
    appendEvent(
      "error",
      `bundle generation failed for ${candidate.id}: ${result.reason}`,
      deps.now(),
    );
    return { ok: false, reason: result.reason };
  }

  const ctx = installContext(deps);
  try {
    if (candidate.suggestedTool === "claude-code") {
      await installClaudeCodeLoop(result.bundleDir, ctx);
    } else {
      await installCodexLoop(result.bundleDir, ctx);
    }
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    appendEvent("error", `installation failed for ${candidate.id}: ${reason}`, deps.now());
    return { ok: false, reason: `installation failed: ${reason}` };
  }

  addToRegistry("installed", candidate.id);
  const stored = getProposal(candidate.id) ?? proposal;
  saveProposal({ ...stored, status: "approved", bundleDir: result.bundleDir });
  appendEvent("approve", `approved + installed "${candidate.id}"`, deps.now());

  // Best-effort: also synthesise a callable MCP tool from the workflow so future
  // agents can run it via `loopeng mcp-tools`. A failure here never unwinds the
  // approved loop — the loop.md install above already succeeded.
  try {
    const tool = await generateToolSpec(candidate, {
      runner: deps.runner,
      bundleDir: result.bundleDir,
      evidence: resolveEvidence(candidate),
    });
    if (tool.ok) {
      appendEvent("approve", `generated MCP tool "${tool.spec.name}" for "${candidate.id}"`, deps.now());
    } else {
      appendEvent("error", `MCP tool generation skipped for ${candidate.id}: ${tool.reason}`, deps.now());
    }
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    appendEvent("error", `MCP tool generation threw for ${candidate.id}: ${reason}`, deps.now());
  }

  return { ok: true };
}

// ── uninstall ────────────────────────────────────────────────────────────────

export async function uninstallAction(deps: CliDeps, id: string): Promise<ActionResult> {
  try {
    validateLoopId(id);
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) };
  }

  const dir = bundleDirFor(getProposal(id), id);

  try {
    await uninstallLoop(dir, installContext(deps));
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    appendEvent("error", `uninstall failed for ${id}: ${reason}`, deps.now());
    return { ok: false, reason: `uninstall failed: ${reason}` };
  }

  const registryFile = join(loopengHome(), "registry", "installed.json");
  const installed = readJson<string[]>(registryFile) ?? [];
  writeJsonAtomic(registryFile, installed.filter((entry) => entry !== id));

  setProposalStatus(id, "dismissed");
  appendEvent("uninstall", `uninstalled "${id}"`, deps.now());
  return { ok: true };
}

// ── dismiss ──────────────────────────────────────────────────────────────────

export async function dismissAction(deps: CliDeps, proposal: Proposal): Promise<ActionResult> {
  try {
    addToRegistry("dismissed", proposal.candidate.id);
    setProposalStatus(proposal.candidate.id, "dismissed");
    appendEvent("dismiss", `dismissed "${proposal.candidate.id}"`, deps.now());
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) };
  }
  return { ok: true };
}

// ── snooze ───────────────────────────────────────────────────────────────────

const SNOOZE_MS = 7 * 24 * 60 * 60 * 1000;

export async function snoozeAction(deps: CliDeps, proposal: Proposal): Promise<ActionResult> {
  try {
    const id = proposal.candidate.id;
    const snoozedUntil = new Date(nowMs(deps) + SNOOZE_MS).toISOString();
    const stored = getProposal(id) ?? proposal;
    saveProposal({ ...stored, status: "snoozed", snoozedUntil });
    appendEvent("snooze", `snoozed "${id}" for 7 days`, deps.now());
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) };
  }
  return { ok: true };
}
