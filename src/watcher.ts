import { spawn as childSpawn } from "node:child_process";
import {
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  unlinkSync,
  watch,
  writeFileSync,
  type FSWatcher
} from "node:fs";
import { homedir, platform } from "node:os";
import { dirname, join, resolve } from "node:path";
import {
  listClaudeCodeTranscripts,
  parseClaudeCodeTranscript
} from "./adapters/claude-code.js";
import { listCodexSessions, parseCodexSession } from "./adapters/codex.js";
import { digestSession } from "./digester.js";
import { appendEvent } from "./events.js";
import { loadConfig, loopengHome, readJson, writeJsonAtomic } from "./state.js";

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

      if (record !== undefined) {
        const digestPath = join(loopengHome(), "digests", `${record.sessionId}.txt`);
        mkdirSync(dirname(digestPath), { recursive: true });
        writeFileSync(digestPath, digestSession(record), "utf8");
        digested.push(record.sessionId);
      }
    }

    state.files[file.path] = mtimeMs;
  }

  writeJsonAtomic(statePath, state);

  if (digested.length > 0) {
    appendEvent(
      "digest",
      `digested ${digested.length} session(s): ${digested.join(", ")}`,
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
    }, 2000);
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
  return {
    claudeProjectsDir: join(homedir(), ".claude", "projects"),
    codexSessionsDir: join(homedir(), ".codex", "sessions"),
    spawn(argv: string[]): number | undefined {
      const command = argv.join(" ");
      const child =
        platform() === "darwin"
          ? childSpawn(
              "osascript",
              ["-e", `tell application "Terminal" to do script "${command}"`],
              { detached: true, stdio: "ignore" }
            )
          : childSpawn(argv[0] ?? "loopeng", argv.slice(1), {
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

  const pid = ctx.spawn(["loopeng", "companion"]);
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
