import { mkdtemp, rm } from "node:fs/promises";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { Candidate, Proposal } from "../src/types.js";
import {
  approveAction,
  scanAction,
  uninstallAction,
} from "../src/actions.js";
import {
  listAction,
  markAction,
  readCompanionState,
  setupAction,
  statusAction,
  type CliDeps
} from "../src/cli.js";
import {
  defineAction,
  forgetPipelineAction,
  listPipelinesAction,
  runPipelineAction,
  showPipelineAction
} from "../src/pipeline-cli.js";
import { loadPipelineState } from "../src/pipeline.js";
import {
  addToRegistry,
  getProposal,
  inRegistry,
  listProposals,
  loopengHome,
  readJson,
  saveProposal,
  writeJsonAtomic
} from "../src/state.js";

const NOW = "2026-06-12T12:00:00.000Z";

let home: string; // LOOPENG_HOME
let userHome: string; // injected homedir
let lines: string[];
let execCalls: { cmd: string; args: string[] }[];

interface TestDeps extends CliDeps {}

function makeDeps(overrides: Partial<CliDeps> = {}): TestDeps {
  return {
    runner: async () => "{}",
    exec: async (cmd, args) => {
      execCalls.push({ cmd, args });
      return { code: 0, out: "" };
    },
    now: () => NOW,
    homedir: () => userHome,
    out: (line) => lines.push(line),
    ...overrides
  };
}

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "loopeng-cli-"));
  userHome = await mkdtemp(join(tmpdir(), "loopeng-cli-home-"));
  process.env.LOOPENG_HOME = home;
  lines = [];
  execCalls = [];
});

afterEach(async () => {
  delete process.env.LOOPENG_HOME;
  await rm(home, { recursive: true, force: true });
  await rm(userHome, { recursive: true, force: true });
});

function candidate(overrides: Partial<Candidate> = {}): Candidate {
  return {
    id: "cand-1",
    type: "recurring_task",
    summary: "Run the same verification command after edits",
    evidence: [{ sessionId: "s-1", events: [0] }],
    occurrences: 3,
    confidence: 0.9,
    suggestedTool: "claude-code",
    impactEstimate: "saves ~30 min/week — because manual reruns",
    ...overrides
  };
}

function claudeSettingsPath(): string {
  return join(userHome, ".claude", "settings.json");
}

describe("setupAction", () => {
  it("writes config, appends the trigger hook preserving existing hooks, installs daemon, and is idempotent", async () => {
    // Pre-seed an unrelated existing hook.
    const settingsPath = claudeSettingsPath();
    mkdirSync(join(userHome, ".claude"), { recursive: true });
    writeFileSync(
      settingsPath,
      `${JSON.stringify(
        {
          hooks: {
            SessionStart: [
              { matcher: "*", hooks: [{ type: "command", command: "echo existing" }] }
            ]
          }
        },
        null,
        2
      )}\n`,
      "utf8"
    );

    const deps = makeDeps();
    await setupAction(deps, { companion: "manual" });

    // config.json
    const config = readJson<{ companion: string }>(join(loopengHome(), "config.json"));
    expect(config?.companion).toBe("manual");

    // both hooks present
    const settings = JSON.parse(readFileSync(settingsPath, "utf8"));
    const sessionStart = settings.hooks.SessionStart as { hooks: { command: string }[] }[];
    const commands = sessionStart.flatMap((e) => e.hooks.map((h) => h.command));
    expect(commands).toContain("echo existing");
    expect(commands.some((c) => c.includes("# loopeng:trigger-hook"))).toBe(true);
    expect(sessionStart).toHaveLength(2);

    // daemon plist written + launchctl load called
    const plistPath = join(userHome, "Library", "LaunchAgents", "com.loopeng.daemon.plist");
    expect(existsSync(plistPath)).toBe(true);
    expect(execCalls).toContainEqual({ cmd: "launchctl", args: ["load", plistPath] });

    // idempotent: second run adds no hook
    await setupAction(makeDeps(), { companion: "manual" });
    const after = JSON.parse(readFileSync(settingsPath, "utf8"));
    expect(after.hooks.SessionStart).toHaveLength(2);
  });

  it("skips the daemon with --no-daemon", async () => {
    await setupAction(makeDeps(), { daemon: false });
    const plistPath = join(userHome, "Library", "LaunchAgents", "com.loopeng.daemon.plist");
    expect(existsSync(plistPath)).toBe(false);
    expect(execCalls).toHaveLength(0);
  });

  it("preserves existing tuned config fields when re-run", async () => {
    writeJsonAtomic(join(loopengHome(), "config.json"), {
      companion: "auto",
      scope: "project",
      recentWindowHours: 1,
      scanMaxAttempts: 3
    });

    await setupAction(makeDeps(), { companion: "manual", daemon: false });

    const config = readJson<Record<string, unknown>>(join(loopengHome(), "config.json"));
    expect(config?.companion).toBe("manual"); // updated
    expect(config?.scope).toBe("project"); // preserved
    expect(config?.recentWindowHours).toBe(1); // preserved
    expect(config?.scanMaxAttempts).toBe(3); // preserved
  });

  it("rejects an invalid --companion value without persisting it", async () => {
    const deps = makeDeps();
    await setupAction(deps, { companion: "bogus" });

    // config.json must not be written with the bogus value.
    const config = readJson<{ companion: string }>(join(loopengHome(), "config.json"));
    expect(config?.companion).not.toBe("bogus");
    expect(config).toBeUndefined();
    // an error line is surfaced to the user
    expect(lines.some((l) => l.includes("invalid --companion"))).toBe(true);
    // nothing installed
    expect(execCalls).toHaveLength(0);
  });
});

describe("readCompanionState", () => {
  it("returns pending proposals and expired snoozes, but hides active snoozes", async () => {
    const nowMs = new Date(NOW).getTime();
    const past = new Date(nowMs - 60_000).toISOString(); // 1 min ago
    const future = new Date(nowMs + 60_000).toISOString(); // 1 min ahead

    // plain pending -> visible
    saveProposal({
      candidate: candidate({ id: "p-pending" }),
      status: "pending",
      createdAt: NOW
    });
    // snoozed, expired -> returns to inbox
    saveProposal({
      candidate: candidate({ id: "p-snooze-expired" }),
      status: "snoozed",
      createdAt: NOW,
      snoozedUntil: past
    });
    // snoozed, still active -> hidden
    saveProposal({
      candidate: candidate({ id: "p-snooze-active" }),
      status: "snoozed",
      createdAt: NOW,
      snoozedUntil: future
    });
    // pending but with an active snooze stamp -> hidden
    saveProposal({
      candidate: candidate({ id: "p-pending-future" }),
      status: "pending",
      createdAt: NOW,
      snoozedUntil: future
    });

    const { proposals } = readCompanionState(makeDeps());
    const ids = proposals.map((p) => p.candidate.id).sort();
    expect(ids).toEqual(["p-pending", "p-snooze-expired"]);
  });

  it("counts sessions by their real end= activity time, not the digest mtime", () => {
    const dir = join(loopengHome(), "digests");
    mkdirSync(dir, { recursive: true });

    const nowMs = new Date(NOW).getTime();
    const recent = new Date(nowMs - 60 * 60 * 1000).toISOString(); // 1h ago → within 4h
    const old = new Date(nowMs - 9 * 60 * 60 * 1000).toISOString(); // 9h ago → outside 4h

    // All three are written "now" (fresh mtime); only the header end= should
    // decide recency. The old session must NOT count despite its fresh mtime.
    writeFileSync(join(dir, "recent.txt"), `=== session recent end=${recent}\nU ${recent} hi`, "utf8");
    writeFileSync(join(dir, "old.txt"), `=== session old end=${old}\nU ${old} hi`, "utf8");
    // No parseable header → falls back to the (fresh) file mtime → counts.
    writeFileSync(join(dir, "nohdr.txt"), "no header here\n", "utf8");

    const { sessions } = readCompanionState(makeDeps());
    expect(sessions).toBe(2);
  });

  it("scopes the count to the current project and reports detected agents", () => {
    const dir = join(loopengHome(), "digests");
    mkdirSync(dir, { recursive: true });
    const recent = new Date(new Date(NOW).getTime() - 60 * 60 * 1000).toISOString();

    writeFileSync(
      join(dir, "here.txt"),
      `=== session here tool=claude-code cwd=/work/projA end=${recent}\nU ${recent} hi`,
      "utf8"
    );
    writeFileSync(
      join(dir, "elsewhere.txt"),
      `=== session elsewhere tool=codex cwd=/work/projB end=${recent}\nU ${recent} hi`,
      "utf8"
    );

    // scope "all": both projects count, both agents detected.
    const all = readCompanionState(makeDeps());
    expect(all.sessions).toBe(2);
    expect(all.tools).toEqual(["claude-code", "codex"]);

    // scope "project": only the current project's session counts.
    process.env.LOOPENG_SCOPE = "project";
    process.env.LOOPENG_PROJECT = "/work/projA";
    try {
      const scoped = readCompanionState(makeDeps());
      expect(scoped.sessions).toBe(1);
      expect(scoped.tools).toEqual(["claude-code"]);
    } finally {
      delete process.env.LOOPENG_SCOPE;
      delete process.env.LOOPENG_PROJECT;
    }
  });
});

describe("markAction", () => {
  it("creates a marker file", async () => {
    await markAction(makeDeps());
    const ms = new Date(NOW).getTime();
    expect(existsSync(join(loopengHome(), "markers", `${ms}.mark`))).toBe(true);
  });
});

describe("scanAction", () => {
  function seedDigests(): void {
    const dir = join(loopengHome(), "digests");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "s-1.txt"), "digest one", "utf8");
    writeFileSync(join(dir, "s-2.txt"), "digest two", "utf8");
  }

  const engineResponse = JSON.stringify({
    candidates: [
      {
        id: "cand-new",
        type: "recurring_task",
        summary: "A new recurring task",
        evidence: [{ sessionId: "s-1", events: [0] }],
        occurrences: 3,
        confidence: 0.9,
        suggestedTool: "claude-code",
        impactEstimate: "saves ~30 min/week — because reasons"
      },
      {
        id: "cand-dismissed",
        type: "hygiene",
        summary: "Already dismissed",
        evidence: [{ sessionId: "s-2", events: [0] }],
        occurrences: 3,
        confidence: 0.9,
        suggestedTool: "codex",
        impactEstimate: "saves ~15 min/week — because reasons"
      }
    ],
    watchlist: [],
    memoryUpdates: ["learned: developers rerun verification"]
  });

  it("saves only new, non-dismissed candidates, appends memory, and dedups on rerun", async () => {
    seedDigests();
    addToRegistry("dismissed", "cand-dismissed");

    const deps = makeDeps({ runner: async () => engineResponse });
    await scanAction(deps);

    const proposals = listProposals();
    expect(proposals.map((p) => p.candidate.id)).toEqual(["cand-new"]);

    const memory = readFileSync(join(loopengHome(), "log", "pattern-memory.txt"), "utf8");
    expect(memory).toContain("learned: developers rerun verification");

    expect(lines).toContain("✨ i spotted 1 loop idea for you");

    // Rerun with no new sessions: short-circuits before touching the engine.
    lines = [];
    await scanAction(
      makeDeps({
        runner: async () => {
          throw new Error("engine must not run when nothing is new");
        }
      })
    );
    expect(listProposals().map((p) => p.candidate.id)).toEqual(["cand-new"]);
    expect(lines).toContain("nothing new to scan — all sessions already analyzed");
  });

  it("truncates an oversized digest so it can't wedge the scan queue", async () => {
    writeJsonAtomic(join(loopengHome(), "config.json"), { scanMaxDigestChars: 100 });

    const dir = join(loopengHome(), "digests");
    mkdirSync(dir, { recursive: true });
    const header = "=== session big tool=claude-code cwd=/w end=2026-06-12T11:00:00.000Z";
    writeFileSync(join(dir, "big.txt"), `${header}\n${"X".repeat(5000)}`, "utf8");

    let received = "";
    const runner = async (prompt: string): Promise<string> => {
      received = prompt;
      return JSON.stringify({ candidates: [], watchlist: [], memoryUpdates: [] });
    };

    const result = await scanAction(makeDeps({ runner }));

    expect(result.ok).toBe(true);
    // The digest was cut to the cap, not sent whole (no permanent over-budget).
    expect(received).not.toContain("X".repeat(200));
    // And the session was marked analyzed, so the queue advances next scan.
    expect(readJson<string[]>(join(loopengHome(), "registry", "analyzed.json"))).toContain("big");
  });

  it("caps the pattern memory so scan prompts stay bounded", async () => {
    const memPath = join(loopengHome(), "log", "pattern-memory.txt");
    mkdirSync(join(loopengHome(), "log"), { recursive: true });
    const old = Array.from({ length: 300 }, (_, i) => `old-${i}`).join("\n");
    writeFileSync(memPath, `${old}\n`, "utf8");

    const dir = join(loopengHome(), "digests");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "s.txt"),
      "=== session s tool=claude-code cwd=/w end=2026-06-12T11:00:00.000Z\nU hi",
      "utf8"
    );

    await scanAction(
      makeDeps({
        runner: async () =>
          JSON.stringify({ candidates: [], watchlist: [], memoryUpdates: ["new-line"] })
      })
    );

    const kept = readFileSync(memPath, "utf8").split("\n").filter((l) => l.length > 0);
    expect(kept.length).toBeLessThanOrEqual(200);
    expect(kept).toContain("new-line"); // newest kept
    expect(kept).toContain("old-299"); // recent old kept
    expect(kept).not.toContain("old-0"); // oldest dropped
  });

  it("strips timestamps from the scan prompt to save tokens, keeping the signal", async () => {
    const dir = join(loopengHome(), "digests");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "alpha.txt"),
      "=== session alpha tool=claude-code cwd=/w end=2026-06-12T11:00:00.000Z\nU 2026-06-12T11:00:01.000Z did a thing",
      "utf8"
    );

    let prompt = "";
    await scanAction(
      makeDeps({
        runner: async (p) => {
          prompt = p;
          return JSON.stringify({ candidates: [], watchlist: [], memoryUpdates: [] });
        }
      })
    );

    expect(prompt).not.toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/); // timestamps stripped
    expect(prompt).toContain("did a thing"); // event content preserved
    expect(prompt).toContain("alpha"); // the session is still whitelisted for evidence
  });

  it("tells the user when the scan engine fails (no silent failure)", async () => {
    const dir = join(loopengHome(), "digests");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "s.txt"),
      "=== session s tool=claude-code cwd=/w end=2026-06-12T11:00:00.000Z\nU hi",
      "utf8"
    );

    lines = [];
    const result = await scanAction(
      makeDeps({
        runner: async () => {
          throw new Error("runner exploded");
        }
      })
    );

    expect(result.ok).toBe(false);
    expect(lines.some((l) => l.includes("scan failed") && l.includes("runner exploded"))).toBe(true);
  });

  it("reports an accurate message when a scan exceeds the remaining budget", async () => {
    writeJsonAtomic(join(loopengHome(), "config.json"), { dailyTokenCap: 100 });
    const dir = join(loopengHome(), "digests");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "s.txt"),
      "=== session s tool=claude-code cwd=/w end=2026-06-12T11:00:00.000Z\nU hi",
      "utf8"
    );

    lines = [];
    await scanAction(makeDeps({ runner: async () => "{}" }));

    // Most of the budget is unused (0/100) — the message must say the scan is
    // too big, not that the budget is "reached".
    expect(lines.some((l) => l.includes("exceeds today's remaining token budget"))).toBe(true);
    expect(lines.some((l) => l.includes("0/100"))).toBe(true);
  });

  it("prunes ids of deleted digests from analyzed.json", async () => {
    const dir = join(loopengHome(), "digests");
    mkdirSync(dir, { recursive: true });
    writeJsonAtomic(join(loopengHome(), "registry", "analyzed.json"), ["ghost"]); // no digest file
    writeFileSync(
      join(dir, "real.txt"),
      "=== session real tool=claude-code cwd=/w end=2026-06-12T11:00:00.000Z\nU hi",
      "utf8"
    );

    await scanAction(
      makeDeps({
        runner: async () => JSON.stringify({ candidates: [], watchlist: [], memoryUpdates: [] })
      })
    );

    const analyzed = readJson<string[]>(join(loopengHome(), "registry", "analyzed.json"));
    expect(analyzed).toContain("real"); // freshly analyzed
    expect(analyzed).not.toContain("ghost"); // pruned — its digest is gone
  });
});

// A runner that satisfies the generator's maker + checker exchange.
function generatorRunner(tool: "claude-code" | "codex"): CliDeps["runner"] {
  const loopMd = [
    "## Responsibility",
    "Guarantee the verification always runs.",
    "## Trigger & cadence",
    "Runs daily at 9am.",
    "## Procedure",
    "Run the verification steps the developer repeats by hand.",
    "## Verification",
    "Run `npm test` and assert the process exits 0.",
    "## Convergence",
    "Stop after at most 3 iterations.",
    "## Escalation",
    "Notify the human after 3 consecutive failures.",
    "",
    "```json",
    JSON.stringify({ kind: "schedule", schedule: "0 9 * * *", tool }),
    "```",
    ""
  ].join("\n");

  return async (prompt: string) => {
    if (prompt.includes("You are the CHECKER")) {
      return JSON.stringify({ verdict: "pass", problems: [] });
    }
    return loopMd;
  };
}

describe("approveAction", () => {
  it("generates a bundle, installs via the suggested tool, and updates registry + status", async () => {
    const proposal: Proposal = {
      candidate: candidate({ id: "cand-approve", suggestedTool: "claude-code" }),
      status: "pending",
      createdAt: NOW
    };
    saveProposal(proposal);

    const deps = makeDeps({ runner: generatorRunner("claude-code") });
    await approveAction(deps, proposal);

    // schedule trigger -> claude-code installer writes a plist under the
    // injected homedir's LaunchAgents and loads it via launchctl.
    const plistPath = join(
      userHome,
      "Library",
      "LaunchAgents",
      "com.loopeng.cand-approve.plist"
    );
    expect(execCalls).toContainEqual({ cmd: "launchctl", args: ["load", plistPath] });

    expect(inRegistry("installed", "cand-approve")).toBe(true);
    const stored = getProposal("cand-approve");
    expect(stored?.status).toBe("approved");
    expect(stored?.bundleDir).toBe(join(loopengHome(), "bundles", "cand-approve"));
  });
});

describe("uninstallAction", () => {
  it("removes the loop from the installed registry and marks it dismissed", async () => {
    const proposal: Proposal = {
      candidate: candidate({ id: "cand-uninstall", suggestedTool: "claude-code" }),
      status: "pending",
      createdAt: NOW
    };
    saveProposal(proposal);

    // Install it first via approveAction so a real bundle/manifest exists.
    await approveAction(makeDeps({ runner: generatorRunner("claude-code") }), proposal);
    expect(inRegistry("installed", "cand-uninstall")).toBe(true);

    await uninstallAction(makeDeps(), "cand-uninstall");

    expect(inRegistry("installed", "cand-uninstall")).toBe(false);
    expect(getProposal("cand-uninstall")?.status).toBe("dismissed");
    // plist was unloaded during uninstall
    const plistPath = join(
      userHome,
      "Library",
      "LaunchAgents",
      "com.loopeng.cand-uninstall.plist"
    );
    expect(execCalls).toContainEqual({ cmd: "launchctl", args: ["unload", plistPath] });
  });
});

describe("status and list", () => {
  it("do not throw on empty state", async () => {
    await expect(statusAction(makeDeps())).resolves.toBeUndefined();
    await expect(listAction(makeDeps())).resolves.toBeUndefined();
    expect(lines.some((l) => l.startsWith("daemon:"))).toBe(true);
    expect(lines.some((l) => l.startsWith("pending proposals:"))).toBe(true);
  });

  it("assemble output from seeded state", async () => {
    const id = "cand-listed";
    const bundleDir = join(loopengHome(), "bundles", id);
    mkdirSync(bundleDir, { recursive: true });
    writeFileSync(
      join(bundleDir, "manifest.json"),
      `${JSON.stringify(
        {
          loopId: id,
          generatedAt: NOW,
          evidence: [],
          tool: "codex",
          installedPaths: [],
          uninstallNotes: []
        },
        null,
        2
      )}\n`,
      "utf8"
    );
    writeFileSync(
      join(bundleDir, "trigger.json"),
      `${JSON.stringify({ kind: "manual", tool: "codex" }, null, 2)}\n`,
      "utf8"
    );
    addToRegistry("installed", id);
    saveProposal({
      candidate: candidate({ id, suggestedTool: "codex" }),
      status: "approved",
      createdAt: NOW,
      bundleDir
    });

    // seed spend + watch state for status
    writeJsonAtomic(join(loopengHome(), "log", "spend.json"), { [NOW.slice(0, 10)]: 1234 });
    writeJsonAtomic(join(loopengHome(), "log", "watch.json"), { files: {} });

    await listAction(makeDeps());
    expect(lines.some((l) => l.includes(id) && l.includes("codex") && l.includes("manual"))).toBe(
      true
    );

    lines = [];
    await statusAction(makeDeps());
    expect(lines.some((l) => l.includes("1234"))).toBe(true);
    expect(lines.some((l) => l.startsWith("last tick:") && !l.includes("never"))).toBe(true);
  });
});

describe("pipeline commands", () => {
  function writePipeline(name: string, body: unknown): string {
    const path = join(home, `${name}.json`);
    writeFileSync(path, JSON.stringify(body), "utf8");
    return path;
  }

  it("defines a pipeline from a file and lists it", async () => {
    const file = writePipeline("p", {
      phases: [
        { name: "implement", instruction: "build it" },
        { name: "test", instruction: "run tests", gate: ["true"] }
      ]
    });
    await defineAction(makeDeps(), "ship", { file });
    expect(lines.some((l) => l.includes('defined "ship"') && l.includes("implement → test"))).toBe(true);

    lines = [];
    listPipelinesAction(makeDeps());
    expect(lines.some((l) => l.startsWith("ship: implement → test"))).toBe(true);
  });

  it("rejects a pipeline whose gate is a shell", async () => {
    const file = writePipeline("bad", {
      phases: [{ name: "x", instruction: "y", gate: ["bash", "-c", "echo hi"] }]
    });
    await defineAction(makeDeps(), "danger", { file });
    expect(lines.some((l) => l.includes("not allowed"))).toBe(true);
  });

  it("runs a pipeline to completion, driving the agent per phase", async () => {
    const file = writePipeline("ok", {
      phases: [
        { name: "implement", instruction: "build it" },
        { name: "test", instruction: "run tests", gate: ["true"] }
      ]
    });
    await defineAction(makeDeps(), "ok", { file });

    const seen: string[] = [];
    lines = [];
    await runPipelineAction(
      makeDeps({ runner: async (p) => { seen.push(p); return "agent worked"; } }),
      "ok",
      {}
    );

    expect(seen).toHaveLength(2); // one agent call per phase
    expect(lines.some((l) => l.includes("complete"))).toBe(true);
    expect(loadPipelineState("ok")).toEqual({ phaseIndex: 0 }); // cleared on success
  });

  it("drafts a pipeline from a plain-English description via the agent", async () => {
    const draft =
      '{"description":"ship","phases":[{"name":"implement","instruction":"build it"},{"name":"test","instruction":"run tests","gate":["npm","test"],"maxAttempts":3}]}';
    lines = [];
    await defineAction(
      makeDeps({ runner: async () => `Here you go:\n${draft}` }),
      "ai",
      { describe: "implement the change then test until green" }
    );
    expect(lines.some((l) => l.includes('defined "ai"') && l.includes("implement → test"))).toBe(true);

    lines = [];
    showPipelineAction(makeDeps(), "ai"); // it was actually saved
    expect(lines.some((l) => l.includes("gate: npm test"))).toBe(true);
  });

  it("reports a clear error when the model returns no pipeline", async () => {
    lines = [];
    await defineAction(makeDeps({ runner: async () => "I can't do that." }), "ai2", {
      describe: "something"
    });
    expect(lines.some((l) => l.includes("could not draft"))).toBe(true);
  });

  it("shows a pipeline's details and forgets it", async () => {
    const file = writePipeline("s", {
      phases: [{ name: "test", instruction: "run tests", gate: ["npm", "test"] }]
    });
    await defineAction(makeDeps(), "demo", { file });

    lines = [];
    showPipelineAction(makeDeps(), "demo");
    expect(lines.some((l) => l.includes("1. test"))).toBe(true);
    expect(lines.some((l) => l.includes("gate: npm test"))).toBe(true);

    lines = [];
    forgetPipelineAction(makeDeps(), "demo");
    expect(lines.some((l) => l.includes('removed pipeline "demo"'))).toBe(true);

    lines = [];
    showPipelineAction(makeDeps(), "demo");
    expect(lines.some((l) => l.includes('no pipeline "demo"'))).toBe(true);
  });

  it("dry-runs without invoking the agent or gates", async () => {
    const file = writePipeline("d", {
      phases: [{ name: "test", instruction: "run tests", gate: ["false"] }]
    });
    await defineAction(makeDeps(), "dry", { file });

    lines = [];
    await runPipelineAction(
      makeDeps({
        runner: async () => {
          throw new Error("agent must not run in dry-run");
        }
      }),
      "dry",
      { dryRun: true }
    );

    expect(lines.some((l) => l.includes("dry run"))).toBe(true);
    expect(lines.some((l) => l.includes("would ask the agent"))).toBe(true);
    expect(lines.some((l) => l.includes("would check gate: false"))).toBe(true);
    expect(lines.some((l) => l.includes("complete"))).toBe(true); // walked all phases
  });

  it("stops on a failing gate and saves resume state", async () => {
    const file = writePipeline("red", {
      phases: [{ name: "test", instruction: "run tests", gate: ["false"], maxAttempts: 2 }]
    });
    await defineAction(makeDeps(), "red", { file });

    lines = [];
    await runPipelineAction(makeDeps({ runner: async () => "tried" }), "red", {});

    expect(lines.some((l) => l.includes("gate still failing"))).toBe(true);
    expect(lines.some((l) => l.includes("resume with"))).toBe(true);
    expect(loadPipelineState("red")).toEqual({ phaseIndex: 0 }); // saved so re-run resumes here
  });
});
