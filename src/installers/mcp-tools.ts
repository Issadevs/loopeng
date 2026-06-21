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
export const CONTROL_SERVER_NAME = CLI_BIN; // `loopeng mcp` control surface

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

// Pure merge of a single named MCP server entry; other servers are preserved,
// and an existing entry is normalised to the wanted command/args.
function withMcpServer(
  config: Record<string, unknown>,
  name: string,
  want: McpServerEntry,
): { config: Record<string, unknown>; changed: boolean } {
  const servers =
    typeof config.mcpServers === "object" &&
    config.mcpServers !== null &&
    !Array.isArray(config.mcpServers)
      ? { ...(config.mcpServers as Record<string, unknown>) }
      : {};

  const current = servers[name];
  const same =
    typeof current === "object" &&
    current !== null &&
    JSON.stringify(current) === JSON.stringify(want);
  if (same) {
    return { config, changed: false };
  }

  servers[name] = want;
  return { config: { ...config, mcpServers: servers }, changed: true };
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
  return withMcpServer(config, TOOLS_SERVER_NAME, desiredEntry());
}

export function withControlServer(
  config: Record<string, unknown>,
): { config: Record<string, unknown>; changed: boolean } {
  return withMcpServer(config, CONTROL_SERVER_NAME, { command: CLI_BIN, args: ["mcp"] });
}

export type RegisterResult =
  | { ok: true; changed: boolean; path: string }
  | { ok: false; reason: string };

// Read, apply a merge, and write ~/.claude.json (only when something changed).
function register(
  homedir: string,
  merge: (config: Record<string, unknown>) => { config: Record<string, unknown>; changed: boolean },
): RegisterResult {
  const path = claudeJsonPath(homedir);
  let config: Record<string, unknown>;
  try {
    config = readConfig(path);
  } catch (e) {
    return { ok: false, reason: (e as Error).message };
  }

  const { config: next, changed } = merge(config);
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

/** Register the `loopeng-tools` (callable workflows) server in ~/.claude.json. */
export function registerToolsServer(homedir: string): RegisterResult {
  return register(homedir, withLoopEngToolsServer);
}

/** Register the `loopeng` (control surface) server in ~/.claude.json. */
export function registerControlServer(homedir: string): RegisterResult {
  return register(homedir, withControlServer);
}
