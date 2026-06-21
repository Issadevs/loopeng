import { execFile } from "node:child_process";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir as osHomedir } from "node:os";
import { join, resolve } from "node:path";
import { Command } from "commander";

import type { Proposal } from "./types.js";
import {
  cwdInScope,
  ensureDirs,
  getProposal,
  listProposals,
  loadConfig,
  loopengHome,
  readJson,
  setProposalStatus,
  writeJsonAtomic,
} from "./state.js";
import { CLI_BIN, DAEMON_LABEL, DAEMON_PLIST_FILENAME, VERSION } from "./constants.js";
import { parseDigestHeader } from "./digester.js";
import { defaultRunner } from "./engine.js";
import {
  defineAction,
  forgetPipelineAction,
  listPipelinesAction,
  runPipelineAction,
  showPipelineAction
} from "./pipeline-cli.js";
import { appendEvent } from "./events.js";
import { startWatcher, defaultContext } from "./watcher.js";
import {
  readBundleManifest,
  readClaudeSettings,
  readTrigger,
  writeClaudeSettings,
} from "./installers/shared.js";
import { runDashboard } from "./dashboard/shell.js";
import { runMcpServer } from "./mcp/index.js";
import { runToolsServer, loadInstalledToolSpecs } from "./mcp/tools.js";
import {
  CONTROL_SERVER_NAME,
  registerControlServer,
  registerToolsServer,
  TOOLS_SERVER_NAME
} from "./installers/mcp-tools.js";
import {
  type CliDeps,
  bundleDirFor,
  claudeSettingsPath,
  installContext,
  launchAgentsDir,
  scanAction,
  uninstallAction,
} from "./actions.js";

export type { CliDeps };

// ── Real deps factory ────────────────────────────────────────────────────────
export function realDeps(): CliDeps {
  return {
    runner: defaultRunner(),
    exec: (cmd, args) =>
      new Promise((resolve) => {
        execFile(cmd, args, (error, stdout, stderr) => {
          const code =
            error && typeof (error as NodeJS.ErrnoException).code === "number"
              ? ((error as unknown as { code: number }).code as number)
              : error
                ? 1
                : 0;
          resolve({ code, out: `${stdout ?? ""}${stderr ?? ""}` });
        });
      }),
    now: () => new Date().toISOString(),
    homedir: () => osHomedir(),
    out: (line) => {
      process.stdout.write(`${line}\n`);
    },
  };
}

export function daemonPlistPath(deps: CliDeps): string {
  return join(launchAgentsDir(deps), DAEMON_PLIST_FILENAME);
}

// ── setup ────────────────────────────────────────────────────────────────────
export interface SetupOpts {
  companion?: string;
  daemon?: boolean;
}

const VALID_COMPANION = ["auto", "manual", "off"] as const;
type CompanionMode = (typeof VALID_COMPANION)[number];

function isCompanionMode(value: string): value is CompanionMode {
  return (VALID_COMPANION as readonly string[]).includes(value);
}

const TRIGGER_HOOK_MARKER = "# loopeng:trigger-hook";

function installTriggerHook(deps: CliDeps): boolean {
  const settingsPath = claudeSettingsPath(deps);
  const settings = readClaudeSettings(settingsPath);

  const hooks =
    typeof settings.hooks === "object" && settings.hooks !== null
      ? (settings.hooks as Record<string, unknown>)
      : {};
  settings.hooks = hooks;

  const sessionStart = Array.isArray(hooks.SessionStart)
    ? (hooks.SessionStart as unknown[])
    : [];
  hooks.SessionStart = sessionStart;

  const alreadyPresent = sessionStart.some((entry) => {
    const inner = (entry as { hooks?: unknown })?.hooks;
    return (
      Array.isArray(inner) &&
      inner.some(
        (h) =>
          typeof (h as { command?: unknown })?.command === "string" &&
          ((h as { command: string }).command).includes(TRIGGER_HOOK_MARKER)
      )
    );
  });

  if (alreadyPresent) {
    return false;
  }

  sessionStart.push({
    matcher: "*",
    hooks: [{ type: "command", command: `loopeng mark ${TRIGGER_HOOK_MARKER}` }]
  });
  writeClaudeSettings(settingsPath, settings);
  return true;
}

function escapeXml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// launchd starts jobs with a bare PATH and no notion of where `loopeng` lives,
// so a relative `loopeng daemon` often can't be found (the daemon then dies
// silently). Pin the absolute node + script path, and carry the PATH captured
// at setup time so the daemon's own child processes (`claude`, `codex`,
// `loopeng companion`) resolve too.
function daemonPlistXml(programArgs: string[], pathEnv: string): string {
  const args = programArgs.map((a) => `    <string>${escapeXml(a)}</string>`).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${DAEMON_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
${args}
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>${escapeXml(pathEnv)}</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
</dict>
</plist>
`;
}

export async function setupAction(deps: CliDeps, opts: SetupOpts): Promise<void> {
  const companion = opts.companion ?? "auto";
  if (!isCompanionMode(companion)) {
    deps.out(`✗ invalid --companion value: ${companion} (expected auto|manual|off)`);
    return; // do not write config or touch anything on bad input
  }

  ensureDirs();

  // Merge over the existing config (and defaults) so re-running setup only
  // changes the companion mode and never silently resets scope, recency window,
  // or scan limits the user has tuned.
  writeJsonAtomic(join(loopengHome(), "config.json"), { ...loadConfig(), companion });
  deps.out(`✓ wrote config (companion: ${companion})`);

  const hookAdded = installTriggerHook(deps);
  deps.out(
    hookAdded
      ? `✓ installed SessionStart trigger hook into ${claudeSettingsPath(deps)}`
      : "· trigger hook already present — skipped"
  );

  if (opts.daemon === false) {
    deps.out("· skipped daemon install (--no-daemon)");
    return;
  }

  const plistPath = daemonPlistPath(deps);
  mkdirSync(launchAgentsDir(deps), { recursive: true });
  const programArgs = [process.execPath, resolve(process.argv[1] ?? CLI_BIN), "daemon"];
  const pathEnv = process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin";
  writeFileSync(plistPath, daemonPlistXml(programArgs, pathEnv), "utf8");
  await deps.exec("launchctl", ["load", plistPath]);
  deps.out(`✓ installed + loaded daemon (${plistPath})`);
}

// ── mark ──────────────────────────────────────────────────────────────────--
export async function markAction(deps: CliDeps): Promise<void> {
  const dir = join(loopengHome(), "markers");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${new Date(deps.now()).getTime()}.mark`), "", "utf8");
}

// ── daemon ────────────────────────────────────────────────────────────────--
export async function daemonAction(deps: CliDeps): Promise<void> {
  startWatcher(defaultContext());
  deps.out("loopEng daemon watching for sessions…");
  await new Promise<never>(() => {
    // Never resolves: keep the process alive for launchd KeepAlive.
  });
}

export function readCompanionState(deps: CliDeps): {
  proposals: Proposal[];
  sessions: number;
  tools: string[];
} {
  const now = new Date(deps.now()).getTime();

  const proposals = listProposals().filter((p) => {
    // A still-active snooze (snoozedUntil in the future) keeps a proposal out
    // of the inbox regardless of status.
    const snoozeActive =
      p.snoozedUntil !== undefined && new Date(p.snoozedUntil).getTime() > now;

    if (p.status === "pending") {
      return !snoozeActive;
    }
    // An expired snooze returns the proposal to the inbox.
    if (p.status === "snoozed") {
      return p.snoozedUntil !== undefined && !snoozeActive;
    }
    return false;
  });

  // Count the sessions loopEng is "watching": those that ended within the
  // recency window AND fall inside the active scope (whole machine, or just the
  // current project). Also collect which agents (claude-code / codex) are
  // active so the dashboard can name what it detects.
  const digestsDir = join(loopengHome(), "digests");
  const cutoff = now - loadConfig().recentWindowHours * 60 * 60 * 1000;
  let sessions = 0;
  const tools = new Set<string>();

  if (existsSync(digestsDir)) {
    for (const entry of readdirSync(digestsDir, { withFileTypes: true })) {
      if (!entry.isFile()) {
        continue;
      }
      const info = readDigestSummary(join(digestsDir, entry.name));
      if (info === undefined || info.activeAt < cutoff || !cwdInScope(info.cwd)) {
        continue;
      }
      sessions += 1;
      if (info.tool !== "") {
        tools.add(info.tool);
      }
    }
  }

  return { proposals, sessions, tools: [...tools].sort() };
}

// Pull the bits of a digest header the dashboard needs: when the session was
// last active, its working dir (for scope), and which agent produced it. The
// `end=` time is preferred over the digest file's mtime — a first-run back-fill
// writes every digest "now", which would otherwise make the whole history look
// like it happened today.
// Only the first line (the header) is needed, so read a bounded prefix instead
// of the whole digest. The dashboard refreshes every few seconds and a machine
// can accumulate hundreds of digests totalling many MB — reading each in full
// each time does not scale.
const DIGEST_HEADER_READ_BYTES = 8192;

function readHeaderLine(path: string): string | undefined {
  let fd: number;
  try {
    fd = openSync(path, "r");
  } catch {
    return undefined; // File vanished between readdir and open — ignore.
  }
  try {
    const buffer = Buffer.allocUnsafe(DIGEST_HEADER_READ_BYTES);
    const bytesRead = readSync(fd, buffer, 0, DIGEST_HEADER_READ_BYTES, 0);
    const text = buffer.toString("utf8", 0, bytesRead);
    const newline = text.indexOf("\n");
    return newline === -1 ? text : text.slice(0, newline);
  } catch {
    return undefined;
  } finally {
    closeSync(fd);
  }
}

function readDigestSummary(
  path: string
): { activeAt: number; cwd: string; tool: string } | undefined {
  const firstLine = readHeaderLine(path);
  if (firstLine === undefined) {
    return undefined;
  }

  const header = parseDigestHeader(firstLine);
  let activeAt = header.endedAtMs;
  if (activeAt === undefined) {
    try {
      activeAt = statSync(path).mtimeMs;
    } catch {
      return undefined;
    }
  }

  return { activeAt, cwd: header.cwd, tool: header.tool };
}

export async function reviewAction(deps: CliDeps): Promise<void> {
  await runDashboard(deps, "inbox");
}

export async function companionAction(deps: CliDeps): Promise<void> {
  await runDashboard(deps, "inbox");
}

// ── list ──────────────────────────────────────────────────────────────────--
export async function listAction(deps: CliDeps): Promise<void> {
  const installed = readJson<string[]>(join(loopengHome(), "registry", "installed.json")) ?? [];

  if (installed.length === 0) {
    deps.out(`no loops installed yet — run ${CLI_BIN} scan to find some`);
    return;
  }

  for (const id of installed) {
    const dir = bundleDirFor(getProposal(id), id);
    try {
      const manifest = readBundleManifest(dir);
      const trigger = readTrigger(dir);
      deps.out(`${manifest.loopId}  ${manifest.tool}  ${trigger.kind}  ${dir}`);
    } catch {
      deps.out(`${id}  (bundle unreadable)  ${dir}`);
    }
  }
}

// ── pause / resume ─────────────────────────────────────────────────────────-
export async function pauseAction(deps: CliDeps): Promise<void> {
  const { code } = await deps.exec("launchctl", ["unload", daemonPlistPath(deps)]);
  if (code === 0) {
    appendEvent("pause", "daemon paused", deps.now());
  }
  deps.out(code === 0 ? "✓ daemon paused" : "daemon not installed?");
}

export async function resumeAction(deps: CliDeps): Promise<void> {
  const { code } = await deps.exec("launchctl", ["load", daemonPlistPath(deps)]);
  if (code === 0) {
    appendEvent("resume", "daemon resumed", deps.now());
  }
  deps.out(code === 0 ? "✓ daemon resumed" : "daemon not installed?");
}

// ── status ────────────────────────────────────────────────────────────────--
export async function statusAction(deps: CliDeps): Promise<void> {
  const plistPath = daemonPlistPath(deps);
  deps.out(`daemon: ${existsSync(plistPath) ? "installed" : "not installed"}`);

  const watchPath = join(loopengHome(), "log", "watch.json");
  let lastTick = "never";
  if (existsSync(watchPath)) {
    try {
      lastTick = new Date(statSync(watchPath).mtimeMs).toISOString();
    } catch {
      lastTick = "never";
    }
  }
  deps.out(`last tick: ${lastTick}`);

  const ledger = readJson<Record<string, number>>(join(loopengHome(), "log", "spend.json")) ?? {};
  const today = deps.now().slice(0, 10);
  const cap = loadConfig().dailyTokenCap;
  deps.out(`today's spend: ${ledger[today] ?? 0} / ${cap} tokens`);

  const pending = listProposals().filter((p) => p.status === "pending").length;
  deps.out(`pending proposals: ${pending}`);
}

// ── MCP tools (callable workflows) ──────────────────────────────────────────-
export async function toolsAction(deps: CliDeps): Promise<void> {
  const specs = loadInstalledToolSpecs();
  if (specs.length === 0) {
    deps.out("No callable MCP tools yet — approve a proposal to generate one.");
    return;
  }
  for (const spec of specs) {
    const params = spec.parameters.map((p) => `${p.name}:${p.type}`).join(", ");
    deps.out(`${spec.name}(${params})  — ${spec.description}`);
  }
}

export async function registerToolsAction(deps: CliDeps): Promise<void> {
  const result = registerToolsServer(deps.homedir());
  if (!result.ok) {
    deps.out(`✗ failed to register ${TOOLS_SERVER_NAME}: ${result.reason}`);
    return;
  }
  deps.out(
    result.changed
      ? `✓ registered ${TOOLS_SERVER_NAME} MCP server in ${result.path}`
      : `· ${TOOLS_SERVER_NAME} already registered in ${result.path}`,
  );
}

export async function registerControlAction(deps: CliDeps): Promise<void> {
  const result = registerControlServer(deps.homedir());
  if (!result.ok) {
    deps.out(`✗ failed to register ${CONTROL_SERVER_NAME}: ${result.reason}`);
    return;
  }
  deps.out(
    result.changed
      ? `✓ registered ${CONTROL_SERVER_NAME} MCP server in ${result.path} — the Claude Code agent can now drive loopEng`
      : `· ${CONTROL_SERVER_NAME} already registered in ${result.path}`,
  );
}

// ── Program assembly ─────────────────────────────────────────────────────────
export function buildProgram(deps: CliDeps): Command {
  const program = new Command();
  program.name(CLI_BIN).description("loopEng — your coding-agent loop companion").version(VERSION);

  program.action(() => runDashboard(deps, "inbox"));

  program
    .command("setup")
    .description("initialize loopEng: config, trigger hook, and daemon")
    .option("--companion <mode>", "companion behaviour: auto | manual | off")
    .option("--no-daemon", "skip installing the background daemon")
    .action((opts: { companion?: string; daemon?: boolean }) =>
      setupAction(deps, {
        companion: opts.companion,
        daemon: opts.daemon
      })
    );

  program
    .command("mark")
    .description("drop a watcher marker (used by the trigger hook)")
    .action(() => markAction(deps));

  program
    .command("daemon")
    .description("run the background watcher")
    .action(() => daemonAction(deps));

  program
    .command("scan")
    .description("analyze digests and propose loops")
    .action(() => void scanAction(deps));

  program
    .command("define <id>")
    .description("define a phased pipeline (from a description, interactively, or JSON)")
    .option("--describe <text>", "draft the pipeline from a plain-English description (AI)")
    .option("--file <path>", "read the pipeline JSON from a file instead of asking")
    .action((id: string, opts: { describe?: string; file?: string }) =>
      void defineAction(deps, id, opts)
    );

  program
    .command("run <id>")
    .description("run or resume a pipeline, driving the agent one phase at a time")
    .option("--restart", "start from the first phase instead of resuming")
    .option("--dry-run", "preview the phases without calling the agent or running gates")
    .action((id: string, opts: { restart?: boolean; dryRun?: boolean }) =>
      void runPipelineAction(deps, id, opts)
    );

  program
    .command("pipelines [id]")
    .description("list pipelines, or show one in detail with <id>")
    .action((id?: string) => (id ? showPipelineAction(deps, id) : listPipelinesAction(deps)));

  program
    .command("forget <id>")
    .description("delete a pipeline")
    .action((id: string) => forgetPipelineAction(deps, id));

  program
    .command("review")
    .description("review pending proposals in the inbox")
    .action(() => reviewAction(deps));

  program
    .command("companion")
    .description("run the ambient companion")
    .action(() => companionAction(deps));

  program
    .command("list")
    .description("list installed loops")
    .action(() => listAction(deps));

  program
    .command("uninstall <id>")
    .description("uninstall a loop by id")
    .action((id: string) => void uninstallAction(deps, id));

  program
    .command("pause")
    .description("pause the background daemon")
    .action(() => pauseAction(deps));

  program
    .command("resume")
    .description("resume the background daemon")
    .action(() => resumeAction(deps));

  program
    .command("status")
    .description("show loopEng status")
    .action(() => statusAction(deps));

  program
    .command("mcp")
    .description("run the MCP server (Model Context Protocol — stdio transport)")
    .action(() => runMcpServer(deps));

  program
    .command("mcp-tools")
    .description("run the loopeng-tools MCP server — exposes approved workflows as callable tools")
    .action(() => runToolsServer());

  program
    .command("tools")
    .description("list the callable MCP tools loopEng has generated from your workflows")
    .action(() => void toolsAction(deps));

  program
    .command("tools-register")
    .description("register the loopeng-tools MCP server in Claude Code (~/.claude.json)")
    .action(() => void registerToolsAction(deps));

  program
    .command("mcp-register")
    .description("register the loopeng control-surface MCP server in Claude Code (~/.claude.json)")
    .action(() => void registerControlAction(deps));

  return program;
}
