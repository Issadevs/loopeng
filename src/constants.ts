import { readFileSync } from "node:fs";

/**
 * Single source of truth for the package version and the fixed names loopEng
 * uses across the CLI, watcher, MCP servers, and installers. Keeping these in
 * one place stops the daemon label written in one file from drifting out of
 * sync with the one read in another.
 */

function readVersion(): string {
  try {
    // package.json sits one level above both src/ (dev via tsx) and dist/ (prod).
    const pkg = JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf8")
    ) as { version?: string };
    return typeof pkg.version === "string" ? pkg.version : "0.0.0";
  } catch {
    return "0.0.0";
  }
}

export const VERSION = readVersion();

/** The CLI binary name (also the MCP server name). */
export const CLI_BIN = "loopeng";

/** launchd label for the background daemon, and its plist filename. */
export const DAEMON_LABEL = "com.loopeng.daemon";
export const DAEMON_PLIST_FILENAME = `${DAEMON_LABEL}.plist`;

/** Prefix for per-loop launchd labels: `${LOOP_LABEL_PREFIX}<loopId>`. */
export const LOOP_LABEL_PREFIX = "com.loopeng.";
