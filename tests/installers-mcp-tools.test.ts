import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  TOOLS_SERVER_NAME,
  claudeJsonPath,
  registerToolsServer,
  withLoopEngToolsServer,
} from "../src/installers/mcp-tools.js";

let home: string;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "loopeng-reg-"));
});

afterEach(async () => {
  await rm(home, { recursive: true, force: true });
});

const entry = { command: "loopeng", args: ["mcp-tools"] };

describe("withLoopEngToolsServer", () => {
  it("adds the server to an empty config", () => {
    const { config, changed } = withLoopEngToolsServer({});
    expect(changed).toBe(true);
    expect((config.mcpServers as Record<string, unknown>)[TOOLS_SERVER_NAME]).toEqual(entry);
  });

  it("preserves other mcp servers", () => {
    const { config } = withLoopEngToolsServer({ mcpServers: { other: { command: "x", args: [] } } });
    const servers = config.mcpServers as Record<string, unknown>;
    expect(servers.other).toEqual({ command: "x", args: [] });
    expect(servers[TOOLS_SERVER_NAME]).toEqual(entry);
  });

  it("is idempotent when already present and identical", () => {
    const once = withLoopEngToolsServer({});
    const twice = withLoopEngToolsServer(once.config);
    expect(twice.changed).toBe(false);
    expect(twice.config).toBe(once.config);
  });

  it("normalises a stale entry back to the desired command/args", () => {
    const { changed, config } = withLoopEngToolsServer({
      mcpServers: { [TOOLS_SERVER_NAME]: { command: "old", args: ["x"] } },
    });
    expect(changed).toBe(true);
    expect((config.mcpServers as Record<string, unknown>)[TOOLS_SERVER_NAME]).toEqual(entry);
  });

  it("preserves unrelated top-level keys", () => {
    const { config } = withLoopEngToolsServer({ theme: "dark" });
    expect(config.theme).toBe("dark");
  });
});

describe("registerToolsServer", () => {
  it("writes a new ~/.claude.json", async () => {
    const result = registerToolsServer(home);
    expect(result).toEqual({ ok: true, changed: true, path: claudeJsonPath(home) });

    const parsed = JSON.parse(await readFile(claudeJsonPath(home), "utf8"));
    expect(parsed.mcpServers[TOOLS_SERVER_NAME]).toEqual(entry);
  });

  it("merges into an existing config and is idempotent on a second run", async () => {
    await writeFile(claudeJsonPath(home), JSON.stringify({ mcpServers: { other: { command: "x", args: [] } } }));

    const first = registerToolsServer(home);
    expect(first.ok && first.changed).toBe(true);

    const second = registerToolsServer(home);
    expect(second).toEqual({ ok: true, changed: false, path: claudeJsonPath(home) });

    const parsed = JSON.parse(await readFile(claudeJsonPath(home), "utf8"));
    expect(parsed.mcpServers.other).toEqual({ command: "x", args: [] });
    expect(parsed.mcpServers[TOOLS_SERVER_NAME]).toEqual(entry);
  });

  it("returns an error when the existing config is corrupt", async () => {
    await writeFile(claudeJsonPath(home), "{ not json");
    const result = registerToolsServer(home);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("Failed to read/parse");
  });
});
