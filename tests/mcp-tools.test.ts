import { mkdtemp, rm } from "node:fs/promises";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Client } from "@modelcontextprotocol/sdk/client";

import { createToolsServer, loadInstalledToolSpecs } from "../src/mcp/tools.js";
import { addToRegistry, ensureDirs, loopengHome, saveProposal } from "../src/state.js";
import type { Candidate } from "../src/types.js";
import type { StepExec } from "../src/toolspec.js";

let home: string;

function candidate(id: string): Candidate {
  return {
    id,
    type: "recurring_task",
    summary: "x",
    confidence: 0.9,
    occurrences: 3,
    impactEstimate: "m",
    suggestedTool: "claude-code",
    evidence: [{ sessionId: "s-1", events: [1] }],
  };
}

/** Install a loop with a tool.json so the tools server can pick it up. */
function installToolLoop(id: string, spec: Record<string, unknown>): void {
  const dir = join(loopengHome(), "bundles", id);
  ensureDirs();
  mkdirSync(dir, { recursive: true });
  saveProposal({ candidate: candidate(id), status: "approved", createdAt: "now", bundleDir: dir });
  addToRegistry("installed", id);
  writeFileSync(join(dir, "tool.json"), JSON.stringify({ loopId: id, ...spec }), "utf8");
}

function mkdirBundle(id: string): void {
  ensureDirs();
  mkdirSync(join(loopengHome(), "bundles", id), { recursive: true });
}

const echoSpec = {
  name: "say_hi",
  description: "Echo a greeting.",
  parameters: [{ name: "who", type: "string", description: "name", required: true }],
  steps: [{ argv: ["echo", "hello ${who}"] }],
};

async function withClient(
  stepExec: StepExec,
  fn: (client: Client) => Promise<void>,
): Promise<void> {
  const server = createToolsServer(stepExec);
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "0.0.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try {
    await fn(client);
  } finally {
    await client.close();
    await server.close();
  }
}

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "loopeng-tools-"));
  process.env.LOOPENG_HOME = home;
  ensureDirs();
});

afterEach(async () => {
  await rm(home, { recursive: true, force: true });
  delete process.env.LOOPENG_HOME;
});

describe("loadInstalledToolSpecs", () => {
  it("returns empty when nothing is installed", () => {
    expect(loadInstalledToolSpecs()).toEqual([]);
  });

  it("skips installed loops that have no tool.json", () => {
    mkdirBundle("loop-no-tool");
    addToRegistry("installed", "loop-no-tool");
    saveProposal({ candidate: candidate("loop-no-tool"), status: "approved", createdAt: "now" });
    expect(loadInstalledToolSpecs()).toEqual([]);
  });

  it("loads a spec from an installed loop", () => {
    installToolLoop("loop-a", echoSpec);
    const specs = loadInstalledToolSpecs();
    expect(specs).toHaveLength(1);
    expect(specs[0].name).toBe("say_hi");
  });

  it("dedupes by tool name (first wins)", () => {
    installToolLoop("loop-a", echoSpec);
    installToolLoop("loop-b", echoSpec);
    expect(loadInstalledToolSpecs()).toHaveLength(1);
  });
});

describe("tools MCP server", () => {
  const noopExec: StepExec = async () => ({ code: 0, out: "" });

  it("lists each installed tool", async () => {
    installToolLoop("loop-a", echoSpec);
    await withClient(noopExec, async (client) => {
      const { tools } = await client.listTools();
      expect(tools.map((t) => t.name)).toContain("say_hi");
      const tool = tools.find((t) => t.name === "say_hi");
      expect(tool?.description).toBe("Echo a greeting.");
    });
  });

  it("exposes only a help tool when none are installed", async () => {
    await withClient(noopExec, async (client) => {
      const { tools } = await client.listTools();
      expect(tools.map((t) => t.name)).toEqual(["loopeng_tools_help"]);
    });
  });

  it("executes the workflow with substituted args (no shell)", async () => {
    installToolLoop("loop-a", echoSpec);
    const exec = vi.fn<Parameters<StepExec>, ReturnType<StepExec>>(async () => ({ code: 0, out: "hello bob" }));

    await withClient(exec, async (client) => {
      const result = await client.callTool({ name: "say_hi", arguments: { who: "bob" } });
      const text = (result.content as { type: string; text: string }[])[0];
      expect(text.text).toContain("completed");
      expect(result.isError).toBeFalsy();
    });

    // The value is passed as a single literal argv token, never shell-split.
    expect(exec.mock.calls[0][0]).toBe("echo");
    expect(exec.mock.calls[0][1]).toEqual(["hello bob"]);
  });

  it("reports a failing step as an error", async () => {
    installToolLoop("loop-a", echoSpec);
    const exec: StepExec = async () => ({ code: 2, out: "boom" });

    await withClient(exec, async (client) => {
      const result = await client.callTool({ name: "say_hi", arguments: { who: "bob" } });
      expect(result.isError).toBe(true);
      const text = (result.content as { type: string; text: string }[])[0];
      expect(text.text).toContain("failed at step 1");
    });
  });

  it("reports a validation error when a required argument is missing", async () => {
    installToolLoop("loop-a", echoSpec);
    await withClient(noopExec, async (client) => {
      const result = await client.callTool({ name: "say_hi", arguments: {} });
      expect(result.isError).toBe(true);
      const text = (result.content as { type: string; text: string }[])[0];
      expect(text.text).toMatch(/who/);
    });
  });
});
