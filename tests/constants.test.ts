import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DAEMON_LABEL, DAEMON_PLIST_FILENAME, VERSION } from "../src/constants.js";

describe("constants", () => {
  it("derives VERSION from package.json (single source of truth)", () => {
    const pkg = JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf8")
    ) as { version: string };
    expect(VERSION).toBe(pkg.version);
  });

  it("derives the daemon plist filename from the daemon label", () => {
    expect(DAEMON_PLIST_FILENAME).toBe(`${DAEMON_LABEL}.plist`);
  });
});
