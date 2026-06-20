import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir, tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Proposal } from "../src/types.js";
import {
  addToRegistry,
  ensureDirs,
  getProposal,
  inRegistry,
  listProposals,
  loadConfig,
  readJson,
  runnerConfig,
  saveProposal,
  setProposalStatus,
  transcriptDirs,
  writeJsonAtomic
} from "../src/state.js";

let home: string;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "loopeng-test-"));
  process.env.LOOPENG_HOME = home;
});

afterEach(async () => {
  delete process.env.LOOPENG_HOME;
  delete process.env.LOOPENG_RUNNER_COMMAND;
  delete process.env.LOOPENG_RUNNER_ARGS;
  delete process.env.LOOPENG_RUNNER_TIMEOUT_MS;
  delete process.env.LOOPENG_JSON_READ_MAX_BYTES;
  delete process.env.LOOPENG_CLAUDE_PROJECTS_DIR;
  delete process.env.LOOPENG_CODEX_SESSIONS_DIR;
  await rm(home, { recursive: true, force: true });
});

describe("state", () => {
  it("creates state directories", async () => {
    ensureDirs();

    for (const dir of ["digests", "proposals", "bundles", "registry", "log"]) {
      const info = await stat(join(home, dir));
      expect(info.isDirectory()).toBe(true);
    }
  });

  it("round-trips JSON with atomic writes", async () => {
    const path = join(home, "digests", "sample.json");
    const value = { ok: true, count: 3 };

    writeJsonAtomic(path, value);

    expect(readJson<typeof value>(path)).toEqual(value);
  });

  it("returns undefined for missing JSON", async () => {
    expect(readJson(join(home, "missing.json"))).toBeUndefined();
  });

  it("returns undefined without parsing JSON files above the size cap", async () => {
    process.env.LOOPENG_JSON_READ_MAX_BYTES = "16";
    const path = join(home, "oversized.json");
    await writeFile(path, `{"value":"${"x".repeat(100)}"}`, "utf8");

    expect(readJson(path)).toBeUndefined();
  });

  it("saves, lists, gets, and updates proposals", async () => {
    const proposal: Proposal = {
      candidate: {
        id: "candidate-1",
        type: "recurring_task",
        summary: "Run the same verification command",
        evidence: [{ sessionId: "session-1", events: [0, 2] }],
        occurrences: 2,
        confidence: 0.8,
        suggestedTool: "codex",
        impactEstimate: "saves ~30 min/week"
      },
      status: "pending",
      createdAt: "2026-06-12T00:00:00.000Z"
    };

    saveProposal(proposal);

    expect(listProposals()).toEqual([proposal]);
    expect(getProposal("candidate-1")).toEqual(proposal);

    setProposalStatus("candidate-1", "approved");

    expect(getProposal("candidate-1")).toEqual({ ...proposal, status: "approved" });
  });

  it("adds and checks registry entries", async () => {
    addToRegistry("installed", "candidate-1");
    addToRegistry("installed", "candidate-1");

    expect(inRegistry("installed", "candidate-1")).toBe(true);
    expect(readJson<string[]>(join(home, "registry", "installed.json"))).toEqual(["candidate-1"]);
  });

  it("loads default config when config.json is absent", async () => {
    expect(loadConfig()).toEqual({
      companion: "auto",
      dailyTokenCap: 100000,
      pollIntervalMin: 15,
      runnerCommand: "claude",
      runnerArgs: ["-p"],
      runnerTimeoutMs: 120000,
      claudeProjectsDir: join(homedir(), ".claude", "projects"),
      codexSessionsDir: join(homedir(), ".codex", "sessions"),
      scope: "all",
      recentWindowHours: 4,
      scanMaxAttempts: 1,
      scanMaxDigestChars: 60000,
      eventsMaxBytes: 512 * 1024,
      eventsKeepLines: 1000,
      mcpToolStepTimeoutMs: 120000,
      mcpToolMaxOutputBytes: 256 * 1024,
      dashboardBusyTickMs: 333,
      dashboardRefreshMs: 5000,
      watcherMarkerDebounceMs: 2000
    });
  });

  it("loads runner settings from config and lets env override them", async () => {
    writeJsonAtomic(join(home, "config.json"), {
      runnerCommand: "/opt/claude",
      runnerArgs: ["-p", "--model", "claude-sonnet"],
      runnerTimeoutMs: 45000
    });

    expect(runnerConfig()).toEqual({
      command: "/opt/claude",
      args: ["-p", "--model", "claude-sonnet"],
      timeoutMs: 45000
    });

    process.env.LOOPENG_RUNNER_COMMAND = "/bin/echo";
    process.env.LOOPENG_RUNNER_ARGS = '["-n"]';
    process.env.LOOPENG_RUNNER_TIMEOUT_MS = "1000";

    expect(runnerConfig()).toEqual({ command: "/bin/echo", args: ["-n"], timeoutMs: 1000 });
  });

  it("loads transcript dirs from config and lets env override them", async () => {
    writeJsonAtomic(join(home, "config.json"), {
      claudeProjectsDir: "~/custom-claude",
      codexSessionsDir: "/tmp/custom-codex"
    });

    expect(transcriptDirs()).toEqual({
      claudeProjectsDir: join(homedir(), "custom-claude"),
      codexSessionsDir: "/tmp/custom-codex"
    });

    process.env.LOOPENG_CLAUDE_PROJECTS_DIR = "/env/claude";
    process.env.LOOPENG_CODEX_SESSIONS_DIR = "/env/codex";

    expect(transcriptDirs()).toEqual({
      claudeProjectsDir: "/env/claude",
      codexSessionsDir: "/env/codex"
    });
  });

  it("rejects proposal IDs with path traversal characters", async () => {
    const proposal: Proposal = {
      candidate: {
        id: "../../etc/passwd",
        type: "recurring_task",
        summary: "Evil",
        evidence: [{ sessionId: "s-1", events: [0] }],
        occurrences: 1,
        confidence: 0.5,
        suggestedTool: "claude-code",
        impactEstimate: "malicious"
      },
      status: "pending",
      createdAt: "2026-06-12T00:00:00.000Z"
    };

    expect(() => saveProposal(proposal)).toThrow("Invalid proposal ID");
  });

  it("rejects proposal IDs with dots", async () => {
    const proposal: Proposal = {
      candidate: {
        id: "candidate..1",
        type: "recurring_task",
        summary: "Evil",
        evidence: [{ sessionId: "s-1", events: [0] }],
        occurrences: 1,
        confidence: 0.5,
        suggestedTool: "claude-code",
        impactEstimate: "malicious"
      },
      status: "pending",
      createdAt: "2026-06-12T00:00:00.000Z"
    };

    expect(() => saveProposal(proposal)).toThrow("Invalid proposal ID");
  });

  it("rejects proposal IDs that are too long", async () => {
    const proposal: Proposal = {
      candidate: {
        id: "a".repeat(65),
        type: "recurring_task",
        summary: "Too long",
        evidence: [{ sessionId: "s-1", events: [0] }],
        occurrences: 1,
        confidence: 0.5,
        suggestedTool: "claude-code",
        impactEstimate: "long"
      },
      status: "pending",
      createdAt: "2026-06-12T00:00:00.000Z"
    };

    expect(() => saveProposal(proposal)).toThrow("Invalid proposal ID");
  });

  it("accepts valid proposal IDs with hyphens and numbers", async () => {
    const proposal: Proposal = {
      candidate: {
        id: "candidate-99",
        type: "recurring_task",
        summary: "Valid",
        evidence: [{ sessionId: "s-1", events: [0] }],
        occurrences: 1,
        confidence: 0.5,
        suggestedTool: "claude-code",
        impactEstimate: "valid"
      },
      status: "pending",
      createdAt: "2026-06-12T00:00:00.000Z"
    };

    expect(() => saveProposal(proposal)).not.toThrow();
    expect(getProposal("candidate-99")).toBeDefined();
  });
});
