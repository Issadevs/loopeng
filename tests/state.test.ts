import { mkdtemp, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
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
  saveProposal,
  setProposalStatus,
  writeJsonAtomic
} from "../src/state.js";

let home: string;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "loopeng-test-"));
  process.env.LOOPENG_HOME = home;
});

afterEach(async () => {
  delete process.env.LOOPENG_HOME;
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
      pollIntervalMin: 15
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
