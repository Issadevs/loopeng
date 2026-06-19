import { mkdtemp, rm } from "node:fs/promises";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Client } from "@modelcontextprotocol/sdk/client";

import { createMcpServer } from "../src/mcp/index.js";
import type { CliDeps } from "../src/actions.js";
import {
  addToRegistry,
  ensureDirs,
  loopengHome,
  saveProposal,
} from "../src/state.js";
import { appendEvent } from "../src/events.js";
import type { Candidate, Proposal } from "../src/types.js";

const NOW = "2026-06-12T12:00:00.000Z";

let home: string;
let outLines: string[];

function makeDeps(overrides: Partial<CliDeps> = {}): CliDeps {
  return {
    runner: async () => "{}",
    exec: async () => ({ code: 0, out: "" }),
    now: () => NOW,
    homedir: () => home,
    out: (line: string) => outLines.push(line),
    ...overrides,
  };
}

function candidate(overrides: Partial<Candidate> = {}): Candidate {
  return {
    id: "cand-1",
    type: "recurring_task",
    summary: "test",
    confidence: 0.8,
    occurrences: 3,
    impactEstimate: "medium",
    suggestedTool: "claude-code",
    evidence: [{ sessionId: "sess-1", events: [1, 2, 3] }],
    ...overrides,
  };
}

async function withClient(
  deps: CliDeps,
  fn: (client: Client) => Promise<void>,
): Promise<void> {
  const server = createMcpServer(deps);
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "0.0.0" });

  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ]);

  try {
    await fn(client);
  } finally {
    await client.close();
    await server.close();
  }
}

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "loopeng-mcp-"));
  process.env.LOOPENG_HOME = home;
  ensureDirs();
  outLines = [];
});

afterEach(async () => {
  await rm(home, { recursive: true, force: true });
  delete process.env.LOOPENG_HOME;
});

/* ── Tools ───────────────────────────────────────────────────────────────── */

describe("tools", () => {
  it("lists all registered tools", async () => {
    await withClient(makeDeps(), async (client) => {
      const { tools } = await client.listTools();
      const names = tools.map((t) => t.name).sort();
      expect(names).toEqual([
        "events",
        "loops_list",
        "loops_uninstall",
        "proposals_approve",
        "proposals_dismiss",
        "proposals_get",
        "proposals_list",
        "proposals_snooze",
        "scan",
        "status",
      ]);
    });
  });

  describe("proposals_list", () => {
    it("returns 'No proposals.' when empty", async () => {
      await withClient(makeDeps(), async (client) => {
        const result = await client.callTool({ name: "proposals_list" });
        const text = result.content[0] as { type: "text"; text: string };
        expect(text.text).toBe("No proposals.");
      });
    });

    it("lists proposals when present", async () => {
      saveProposal({
        candidate: candidate({ id: "a-1", summary: "loop A" }),
        status: "pending",
        createdAt: NOW,
      });
      saveProposal({
        candidate: candidate({ id: "b-2", summary: "loop B" }),
        status: "approved",
        createdAt: NOW,
      });

      await withClient(makeDeps(), async (client) => {
        const result = await client.callTool({ name: "proposals_list" });
        const text = result.content[0] as { type: "text"; text: string };
        expect(text.text).toContain("[pending] a-1");
        expect(text.text).toContain("[approved] b-2");
      });
    });
  });

  describe("proposals_get", () => {
    it("returns not found for unknown id", async () => {
      await withClient(makeDeps(), async (client) => {
        const result = await client.callTool({
          name: "proposals_get",
          arguments: { id: "nope" },
        });
        const text = result.content[0] as { type: "text"; text: string };
        expect(text.text).toBe('Proposal "nope" not found.');
      });
    });

    it("returns proposal details", async () => {
      saveProposal({
        candidate: candidate({ id: "a-1", summary: "my loop" }),
        status: "pending",
        createdAt: NOW,
      });

      await withClient(makeDeps(), async (client) => {
        const result = await client.callTool({
          name: "proposals_get",
          arguments: { id: "a-1" },
        });
        const text = result.content[0] as { type: "text"; text: string };
        expect(text.text).toContain("ID: a-1");
        expect(text.text).toContain("Status: pending");
        expect(text.text).toContain("Summary: my loop");
      });
    });
  });

  describe("proposals_approve", () => {
    it("rejects non-pending status", async () => {
      saveProposal({
        candidate: candidate({ id: "a-1" }),
        status: "approved",
        createdAt: NOW,
      });

      await withClient(makeDeps(), async (client) => {
        const result = await client.callTool({
          name: "proposals_approve",
          arguments: { id: "a-1" },
        });
        const text = result.content[0] as { type: "text"; text: string };
        expect(text.text).toContain("is approved, not pending");
      });
    });

    it("returns error when bundle generation fails", async () => {
      saveProposal({
        candidate: candidate({ id: "a-1" }),
        status: "pending",
        createdAt: NOW,
      });

      await withClient(makeDeps({ runner: async () => "not json" }), async (client) => {
        const result = await client.callTool({
          name: "proposals_approve",
          arguments: { id: "a-1" },
        });
        const text = result.content[0] as { type: "text"; text: string };
        expect(text.text).toContain("Failed:");
      });
    });
  });

  describe("proposals_dismiss", () => {
    it("dismisses a pending proposal", async () => {
      saveProposal({
        candidate: candidate({ id: "a-1" }),
        status: "pending",
        createdAt: NOW,
      });

      await withClient(makeDeps(), async (client) => {
        const result = await client.callTool({
          name: "proposals_dismiss",
          arguments: { id: "a-1" },
        });
        const text = result.content[0] as { type: "text"; text: string };
        expect(text.text).toBe('Dismissed "a-1".');
      });
    });

    it("returns not found for unknown id", async () => {
      await withClient(makeDeps(), async (client) => {
        const result = await client.callTool({
          name: "proposals_dismiss",
          arguments: { id: "nope" },
        });
        const text = result.content[0] as { type: "text"; text: string };
        expect(text.text).toBe('Proposal "nope" not found.');
      });
    });
  });

  describe("proposals_snooze", () => {
    it("snoozes a pending proposal", async () => {
      saveProposal({
        candidate: candidate({ id: "a-1" }),
        status: "pending",
        createdAt: NOW,
      });

      await withClient(makeDeps(), async (client) => {
        const result = await client.callTool({
          name: "proposals_snooze",
          arguments: { id: "a-1" },
        });
        const text = result.content[0] as { type: "text"; text: string };
        expect(text.text).toBe('Snoozed "a-1" for 7 days.');
      });
    });
  });

  describe("scan", () => {
    it("returns error when the engine throws", async () => {
      // A pending digest is required for the scan to reach the engine.
      mkdirSync(join(loopengHome(), "digests"), { recursive: true });
      writeFileSync(join(loopengHome(), "digests", "sess-1.txt"), "digest text", "utf8");

      await withClient(
        makeDeps({
          runner: async () => {
            throw new Error("engine down");
          },
        }),
        async (client) => {
          const result = await client.callTool({ name: "scan" });
          const text = result.content[0] as { type: "text"; text: string };
          expect(text.text).toContain("Scan failed:");
          expect(text.text).toContain("engine down");
        },
      );
    });
  });

  describe("loops_list", () => {
    it("returns 'No loops installed.' when empty", async () => {
      await withClient(makeDeps(), async (client) => {
        const result = await client.callTool({ name: "loops_list" });
        const text = result.content[0] as { type: "text"; text: string };
        expect(text.text).toBe("No loops installed.");
      });
    });
  });

  describe("loops_uninstall", () => {
    it("returns error for unknown id", async () => {
      await withClient(makeDeps(), async (client) => {
        const result = await client.callTool({
          name: "loops_uninstall",
          arguments: { id: "nope" },
        });
        const text = result.content[0] as { type: "text"; text: string };
        expect(text.text).toContain("Failed:");
      });
    });
  });

  describe("events", () => {
    it("returns 'No events.' when empty", async () => {
      await withClient(makeDeps(), async (client) => {
        const result = await client.callTool({ name: "events", arguments: {} });
        const text = result.content[0] as { type: "text"; text: string };
        expect(text.text).toBe("No events.");
      });
    });

    it("returns events when present", async () => {
      appendEvent("scan", "scan ran", NOW);
      appendEvent("approve", "approved a-1", NOW);

      await withClient(makeDeps(), async (client) => {
        const result = await client.callTool({ name: "events", arguments: {} });
        const text = result.content[0] as { type: "text"; text: string };
        expect(text.text).toContain("[2026-06-12T12:00:00.000Z] scan: scan ran");
        expect(text.text).toContain("[2026-06-12T12:00:00.000Z] approve: approved a-1");
      });
    });

    it("respects limit parameter", async () => {
      for (let i = 0; i < 10; i++) {
        appendEvent("scan", `event ${i}`, NOW);
      }

      await withClient(makeDeps(), async (client) => {
        const result = await client.callTool({
          name: "events",
          arguments: { limit: 3 },
        });
        const text = result.content[0] as { type: "text"; text: string };
        const lines = text.text.split("\n");
        expect(lines).toHaveLength(3);
      });
    });
  });

  describe("status", () => {
    it("returns status fields", async () => {
      await withClient(makeDeps(), async (client) => {
        const result = await client.callTool({ name: "status" });
        const text = result.content[0] as { type: "text"; text: string };
        expect(text.text).toContain("Companion:");
        expect(text.text).toContain("Daily token cap:");
        expect(text.text).toContain("Pending proposals:");
      });
    });
  });
});

/* ── Resources ────────────────────────────────────────────────────────────── */

describe("resources", () => {
  it("lists resource templates", async () => {
    await withClient(makeDeps(), async (client) => {
      const { resourceTemplates } = await client.listResourceTemplates();
      const names = resourceTemplates.map((t) => t.name);
      expect(names).toContain("proposal");
    });
  });

  it("reads a proposal resource", async () => {
    saveProposal({
      candidate: candidate({ id: "a-1", summary: "test loop" }),
      status: "pending",
      createdAt: NOW,
    });

    await withClient(makeDeps(), async (client) => {
      const result = await client.readResource({
        uri: "loopeng://proposals/a-1",
      });
      const contents = result.contents as { uri: string; text: string; mimeType: string }[];
      expect(contents[0].mimeType).toBe("application/json");
      const parsed = JSON.parse(contents[0].text);
      expect(parsed.candidate.id).toBe("a-1");
    });
  });

  it("reads events resource", async () => {
    appendEvent("scan", "test event", NOW);

    await withClient(makeDeps(), async (client) => {
      const result = await client.readResource({ uri: "loopeng://events" });
      const contents = result.contents as { text: string }[];
      const parsed = JSON.parse(contents[0].text);
      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed[0].msg).toBe("test event");
    });
  });

  it("reads status resource", async () => {
    await withClient(makeDeps(), async (client) => {
      const result = await client.readResource({ uri: "loopeng://status" });
      const contents = result.contents as { text: string }[];
      const parsed = JSON.parse(contents[0].text);
      expect(parsed).toHaveProperty("config");
      expect(parsed).toHaveProperty("spendToday");
      expect(parsed).toHaveProperty("pendingProposals");
    });
  });
});
