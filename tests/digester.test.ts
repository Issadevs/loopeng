import { describe, expect, it } from "vitest";
import type { SessionEvent, SessionRecord } from "../src/types.js";
import {
  compactDigestForPrompt,
  digestSession,
  digestSessions,
  parseDigestHeader,
  redact
} from "../src/digester.js";

describe("redact", () => {
  it("redacts every planted secret type while keeping surrounding prose", () => {
    const secrets = [
      "sk-abc123XYZsecretsecret",
      "ghp_aaaaaaaaaaaaaaaaaaaa",
      "supersecretvalue123", // value of API_KEY=
      "hunter2hunter2", // value of password:
      "AKIAIOSFODNN7EXAMPLE",
      "aB3dEfGh1JkLmNo2PqRsTu3VwXyZ4abc", // 32-char mixed base64 blob
      "u:p4ss", // URL credential userinfo
    ];

    const text = [
      "My openai key is sk-abc123XYZsecretsecret and it works.",
      "github token ghp_aaaaaaaaaaaaaaaaaaaa here.",
      "config API_KEY=supersecretvalue123 done.",
      "login password: hunter2hunter2 ok.",
      "aws AKIAIOSFODNN7EXAMPLE creds.",
      "blob aB3dEfGh1JkLmNo2PqRsTu3VwXyZ4abc end.",
      "url https://u:p4ss@x.com fetch.",
    ].join("\n");

    const out = redact(text);

    for (const secret of secrets) {
      expect(out).not.toContain(secret);
    }
    // The base64-ish bodies of prefix tokens must not leak either.
    expect(out).not.toContain("abc123XYZsecretsecret");
    expect(out).not.toContain("p4ss");

    // Surrounding prose survives.
    for (const word of [
      "works",
      "config",
      "done",
      "login",
      "ok",
      "creds",
      "blob",
      "end",
      "fetch",
      "x.com",
    ]) {
      expect(out).toContain(word);
    }
    expect(out).toContain("[REDACTED]");
  });

  it("redacts private key blocks, JWTs, and Google API keys", () => {
    const pem =
      "-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXktdjEAAAAA\nQUFB\n-----END OPENSSH PRIVATE KEY-----";
    const jwt =
      "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U";
    const google = "AIzaSyA1234567890abcdefGHIJKLmnopQRSTuv";

    const pemOut = redact(`key:\n${pem}\nend`);
    expect(pemOut).not.toContain("b3BlbnNzaC1rZXktdjEAAAAA");
    expect(pemOut).toContain("[REDACTED]");
    expect(pemOut).toContain("end");

    expect(redact(`token ${jwt} here`)).not.toContain(jwt);
    expect(redact(`token ${jwt} here`)).toContain("here");
    expect(redact(`gkey ${google} ok`)).not.toContain(google);
  });

  it("leaves ordinary prose, paths, URLs, timestamps and UUIDs untouched", () => {
    const negatives = [
      "The quick brown fox jumps over the lazy dog.",
      "/Users/foo/projects/bar-baz",
      // Mixed-case path WITH digits must not be redacted.
      "/Users/Foo/projects/bar1-baz-quux",
      "https://example.com/docs/getting-started",
      // Long mixed-case URL path segment (24+ chars, digits) must pass through.
      "https://example.com/Abcdefghijklmnop1234567890",
      "2026-06-12T11:44:20.097-05:00",
      "550e8400-e29b-41d4-a716-446655440000",
    ];
    for (const n of negatives) {
      expect(redact(n)).toBe(n);
    }
  });
});

describe("digestSession", () => {
  it("matches the golden format exactly", () => {
    const record: SessionRecord = {
      tool: "claude-code",
      sessionId: "sess-1",
      startedAt: "2026-06-12T10:00:00.000Z",
      endedAt: "2026-06-12T10:05:00.000Z",
      cwd: "/home/user/proj",
      branch: "main",
      events: [
        { t: "2026-06-12T10:00:01.000Z", kind: "user_msg", text: "Fix the build" },
        { t: "2026-06-12T10:00:02.000Z", kind: "command", name: "npm run build" },
        {
          t: "2026-06-12T10:00:03.000Z",
          kind: "tool_call",
          name: "edit",
          summary: "patched src/index.ts",
        },
        { t: "2026-06-12T10:00:04.000Z", kind: "error", summary: "type error in foo" },
      ],
    };

    const expected = [
      "=== session sess-1 tool=claude-code cwd=/home/user/proj branch=main start=2026-06-12T10:00:00.000Z end=2026-06-12T10:05:00.000Z",
      "U 2026-06-12T10:00:01.000Z Fix the build",
      "C 2026-06-12T10:00:02.000Z npm run build",
      "T 2026-06-12T10:00:03.000Z edit: patched src/index.ts",
      "E 2026-06-12T10:00:04.000Z type error in foo",
    ].join("\n");

    expect(digestSession(record)).toBe(expected);
  });

  it("falls back to '-' for a missing branch and converts newlines to spaces", () => {
    const record: SessionRecord = {
      tool: "codex",
      sessionId: "s2",
      startedAt: "2026-06-12T10:00:00.000Z",
      endedAt: "2026-06-12T10:01:00.000Z",
      cwd: "/tmp",
      events: [{ t: "2026-06-12T10:00:01.000Z", kind: "user_msg", text: "line one\nline two" }],
    };
    const out = digestSession(record);
    expect(out).toContain("branch=-");
    expect(out).toContain("U 2026-06-12T10:00:01.000Z line one line two");
    expect(out).not.toContain("\nline two");
  });

  it("caps a very long session to the most recent events, keeping the header", () => {
    const events: SessionEvent[] = [];
    for (let i = 0; i < 1500; i++) {
      events.push({ t: "2026-06-12T10:00:00.000Z", kind: "command", name: `cmd-${i}` });
    }
    const record: SessionRecord = {
      tool: "claude-code",
      sessionId: "long",
      startedAt: "2026-06-12T10:00:00.000Z",
      endedAt: "2026-06-12T11:00:00.000Z",
      cwd: "/tmp/work",
      events
    };

    const digest = digestSession(record);
    const lines = digest.split("\n");
    expect(lines.length).toBe(1001); // header + 1000 most-recent events
    expect(lines[0]).toContain("=== session long"); // header preserved
    expect(digest).toContain("cmd-1499"); // newest kept
    expect(digest).not.toContain("cmd-0 "); // oldest dropped
  });

  it("digests large sessions to <=10% of the raw JSON size", () => {
    const events: SessionEvent[] = [];
    for (let i = 0; i < 50; i++) {
      events.push({
        t: `2026-06-12T10:${String(i % 60).padStart(2, "0")}:00.000Z`,
        kind: "user_msg",
        // Long event text — truncation to 200 chars drives the compaction.
        text: "lorem ipsum dolor sit amet consectetur adipiscing elit ".repeat(80),
      });
    }
    const record: SessionRecord = {
      tool: "codex",
      sessionId: "big",
      startedAt: "2026-06-12T10:00:00.000Z",
      endedAt: "2026-06-12T11:00:00.000Z",
      cwd: "/tmp/work",
      events,
    };

    const digest = digestSession(record);
    const raw = JSON.stringify(record).length;
    expect(digest.length).toBeLessThanOrEqual(raw * 0.1);
  });
});

describe("compactDigestForPrompt", () => {
  it("strips ISO timestamps and extra spaces but keeps the signal", () => {
    const digest =
      "=== session s1 tool=claude-code cwd=/x start=2026-06-12T10:00:00.000Z end=2026-06-12T10:05:00.000Z\n" +
      "U 2026-06-12T10:00:01.000Z Fix the build";
    const out = compactDigestForPrompt(digest);
    expect(out).not.toMatch(/\d{4}-\d{2}-\d{2}T/); // no timestamps left
    expect(out).toContain("session s1");
    expect(out).toContain("tool=claude-code");
    expect(out).toContain("U Fix the build"); // event content preserved, single-spaced
    expect(out.length).toBeLessThan(digest.length); // genuinely smaller
  });
});

describe("parseDigestHeader", () => {
  it("keeps a cwd that contains spaces intact", () => {
    const line =
      "=== session s1 tool=claude-code cwd=/Users/me/My Project branch=main start=2026-06-12T10:00:00.000Z end=2026-06-12T10:05:00.000Z";
    const h = parseDigestHeader(line);
    expect(h.sessionId).toBe("s1");
    expect(h.tool).toBe("claude-code");
    expect(h.cwd).toBe("/Users/me/My Project");
    expect(h.endedAtMs).toBe(new Date("2026-06-12T10:05:00.000Z").getTime());
  });
});

describe("digestSessions", () => {
  function makeRecord(sessionId: string, startedAt: string): SessionRecord {
    return {
      tool: "codex",
      sessionId,
      startedAt,
      endedAt: startedAt,
      cwd: "/tmp",
      events: [{ t: startedAt, kind: "user_msg", text: `hello ${sessionId}` }],
    };
  }

  it("is deterministic regardless of input order", () => {
    const a = makeRecord("a", "2026-06-12T10:00:00.000Z");
    const b = makeRecord("b", "2026-06-12T11:00:00.000Z");
    const c = makeRecord("c", "2026-06-12T12:00:00.000Z");

    const sorted = digestSessions([a, b, c]);
    const shuffled = digestSessions([c, a, b]);

    expect(shuffled).toBe(sorted);
    // Blank line between sessions.
    expect(sorted.split("\n\n")).toHaveLength(3);
  });
});
