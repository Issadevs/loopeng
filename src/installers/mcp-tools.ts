import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { CLI_BIN } from "../constants.js";

/**
 * Register the loopeng-tools MCP server in Claude Code's config so the agent
 * discovers the workflows loopeng has turned into callable tools. Claude Code
 * reads MCP servers from ~/.claude.json under the top-level `mcpServers` map;
 * we merge in a single `loopeng-tools` entry, never touching other servers.
 */

export const TOOLS_SERVER_NAME = `${CLI_BIN}-tools`;

export function claudeJsonPath(homedir: string): string {
  return join(homedir, ".claude.json");
}

interface McpServerEntry {
  command: string;
  args: string[];
}

function desiredEntry(): McpServerEntry {
  return { command: CLI_BIN, args: ["mcp-tools"] };
}

function readConfig(path: string): Record<string, unknown> {
  if (!existsSync(path)) {
    return {};
  }
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch (e) {
    throw new Error(
      `Failed to read/parse Claude config at ${path}: ${(e as Error).message}`,
    );
  }
}

/**
 * Pure merge: returns the config with a loopeng-tools server entry present, plus
 * whether anything changed. Existing entries for other servers are preserved;
 * an existing loopeng-tools entry is normalised to the current command/args.
 */
export function withLoopEngToolsServer(
  config: Record<string, unknown>,
): { config: Record<string, unknown>; changed: boolean } {
  const servers =
    typeof config.mcpServers === "object" &&
    config.mcpServers !== null &&
    !Array.isArray(config.mcpServers)
      ? { ...(config.mcpServers as Record<string, unknown>) }
      : {};

  const want = desiredEntry();
  const current = servers[TOOLS_SERVER_NAME];
  const same =
    typeof current === "object" &&
    current !== null &&
    JSON.stringify(current) === JSON.stringify(want);

  if (same) {
    return { config, changed: false };
  }

  servers[TOOLS_SERVER_NAME] = want;
  return { config: { ...config, mcpServers: servers }, changed: true };
}

export type RegisterResult =
  | { ok: true; changed: boolean; path: string }
  | { ok: false; reason: string };

/** Read, merge, and write the loopeng-tools entry into ~/.claude.json. */
export function registerToolsServer(homedir: string): RegisterResult {
  const path = claudeJsonPath(homedir);
  let config: Record<string, unknown>;
  try {
    config = readConfig(path);
  } catch (e) {
    return { ok: false, reason: (e as Error).message };
  }

  const { config: next, changed } = withLoopEngToolsServer(config);
  if (!changed) {
    return { ok: true, changed: false, path };
  }

  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  } catch (e) {
    return { ok: false, reason: (e as Error).message };
  }
  return { ok: true, changed: true, path };
}
