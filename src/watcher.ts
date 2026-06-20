import { spawn as childSpawn } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  unlinkSync,
  watch,
  writeFileSync,
  type FSWatcher
} from "node:fs";
import { platform } from "node:os";
import { dirname, join, resolve } from "node:path";
import {
  listClaudeCodeTranscripts,
  parseClaudeCodeTranscript
} from "./adapters/claude-code.js";
import { listCodexSessions, parseCodexSession } from "./adapters/codex.js";
import { digestSession } from "./digester.js";
import { appendEvent } from "./events.js";
import {
  cwdInScope,
  loadConfig,
  loopengHome,
  readJson,
  transcriptDirs,
  writeJsonAtomic
} from "./state.js";
import { CLI_BIN } from "./constants.js";

export interface WatchContext {
  claudeProjectsDir: string;
  codexSessionsDir: string;
  spawn: (argv: string[]) => number | undefined;
  isPidAlive: (pid: number) => boolean;
  now: () => string;
}

export interface TickResult {
  digested: string[];
  markersConsumed: number;
  companionSpawned: boolean;
}

export interface WatchOptions {
  // Open the ambient companion window when new activity is digested. Defaults
  // to true (the launchd daemon). The in-dashboard watcher sets this false,
  // since the dashboard is already the foreground UI.
  spawnCompanion?: boolean;
}

interface WatchState {
  files: Record<string, number>;
}

interface CompanionLock {
  pid: number;
}

type TranscriptSource = "claude-code" | "codex";

interface TranscriptFile {
  path: string;
  source: TranscriptSource;
}

export async function tick(ctx: WatchContext, opts: WatchOptions = {}): Promise<TickResult> {
  const markersConsumed = consumeMarkers();
  const statePath = join(loopengHome(), "log", "watch.json");
  const state = readJson<WatchState>(statePath) ?? { files: {} };
  const digested: string[] = [];
  const created: string[] = []; // first-time digests only, for a quiet activity log

  for (const file of listTranscriptFiles(ctx)) {
    const mtimeMs = fileMtimeMs(file.path);
    if (mtimeMs === undefined || state.files[file.path] === mtimeMs) {
      continue;
    }

    const content = readTranscript(file.path);
    if (content !== undefined) {
      const record =
        file.source === "claude-code"
          ? parseClaudeCodeTranscript(content)
          : parseCodexSession(content);

      // Only digest sessions inside the active scope (whole machine, or just the
      // current project). Out-of-scope transcripts still fall through to be
      // marked seen below, so we don't re-parse them on every tick.
      if (record !== undefined && cwdInScope(record.cwd)) {
        const digestPath = join(loopengHome(), "digests", `${record.sessionId}.txt`);
        const isNew = !existsSync(digestPath);
        mkdirSync(dirname(digestPath), { recursive: true, mode: 0o700 });
        // Digests hold (redacted) session content — keep them owner-only, and
        // re-assert the mode on rewrite so pre-existing 0644 files are fixed too.
        writeFileSync(digestPath, digestSession(record), { encoding: "utf8", mode: 0o600 });
        chmodSync(digestPath, 0o600);
        digested.push(record.sessionId);
        if (isNew) {
          created.push(record.sessionId);
        }
      }
    }

    state.files[file.path] = mtimeMs;
  }

  writeJsonAtomic(statePath, state);

  // Log only the first time a session is seen. An ongoing session is re-digested
  // every tick as it grows; logging each of those would flood the activity feed
  // with identical lines.
  if (created.length > 0) {
    appendEvent(
      "digest",
      `noticed ${created.length} new session(s): ${created.join(", ")}`,
      ctx.now()
    );
  }

  const companionSpawned =
    (opts.spawnCompanion ?? true) && (markersConsumed > 0 || digested.length > 0)
      ? maybeSpawnCompanion(ctx)
      : false;

  if (companionSpawned) {
    appendEvent("spawn", "opened companion window", ctx.now());
  }

  return { digested, markersConsumed, companionSpawned };
}

export function startWatcher(ctx: WatchContext, opts: WatchOptions = {}): { stop(): void } {
  void tick(ctx, opts);

  const intervalMs = loadConfig().pollIntervalMin * 60 * 1000;
  const interval = setInterval(() => {
    void tick(ctx, opts);
  }, intervalMs);
  interval.unref();

  const markersDir = markersPath();
  mkdirSync(markersDir, { recursive: true });

  let debounce: NodeJS.Timeout | undefined;
  const watcher = watch(markersDir, () => {
    if (debounce !== undefined) {
      clearTimeout(debounce);
    }

    debounce = setTimeout(() => {
      debounce = undefined;
      void tick(ctx, opts);
    }, loadConfig().watcherMarkerDebounceMs);
    debounce.unref();
  });

  return {
    stop(): void {
      clearInterval(interval);
      if (debounce !== undefined) {
        clearTimeout(debounce);
      }
      closeWatcher(watcher);
    }
  };
}

export function defaultContext(): WatchContext {
  const dirs = transcriptDirs();
  return {
    claudeProjectsDir: dirs.claudeProjectsDir,
    codexSessionsDir: dirs.codexSessionsDir,
    spawn(argv: string[]): number | undefined {
      const command = argv.join(" ");
      const child =
        platform() === "darwin"
          ? childSpawn(
              "osascript",
              ["-e", `tell application "Terminal" to do script "${command}"`],
              { detached: true, stdio: "ignore" }
            )
          : childSpawn(argv[0] ?? CLI_BIN, argv.slice(1), {
              detached: true,
              stdio: "ignore"
            });

      child.unref();
      return child.pid;
    },
    isPidAlive(pid: number): boolean {
      try {
        process.kill(pid, 0);
        return true;
      } catch {
        return false;
      }
    },
    now: () => new Date().toISOString()
  };
}

function consumeMarkers(): number {
  const dir = markersPath();
  mkdirSync(dir, { recursive: true });

  let consumed = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile()) {
      continue;
    }

    try {
      unlinkSync(join(dir, entry.name));
      consumed += 1;
    } catch {
      // Another watcher may have consumed it first.
    }
  }

  return consumed;
}

function listTranscriptFiles(ctx: WatchContext): TranscriptFile[] {
  return [
    ...listClaudeCodeTranscripts(ctx.claudeProjectsDir).map((path) => ({
      path: resolve(path),
      source: "claude-code" as const
    })),
    ...listCodexSessions(ctx.codexSessionsDir).map((path) => ({
      path: resolve(path),
      source: "codex" as const
    }))
  ];
}

function fileMtimeMs(path: string): number | undefined {
  try {
    return statSync(path).mtimeMs;
  } catch {
    return undefined;
  }
}

function readTranscript(path: string): string | undefined {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return undefined;
  }
}

function maybeSpawnCompanion(ctx: WatchContext): boolean {
  if (loadConfig().companion !== "auto") {
    return false;
  }

  const lockPath = join(loopengHome(), "companion.lock");
  const lock = readJson<CompanionLock>(lockPath);
  if (lock !== undefined && ctx.isPidAlive(lock.pid)) {
    return false;
  }

  const pid = ctx.spawn([CLI_BIN, "companion"]);
  if (pid !== undefined) {
    writeJsonAtomic(lockPath, { pid });
  }
  return true;
}

function markersPath(): string {
  return join(loopengHome(), "markers");
}

function closeWatcher(watcher: FSWatcher): void {
  watcher.close();
}
