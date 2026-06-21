import type { SessionRecord } from "./types.js";

/**
 * Deterministically redact secrets from arbitrary text.
 *
 * Rules are applied in order:
 *  1. Known token prefixes followed by 8+ non-space chars.
 *  2. `key=value` / `key: value` where the key looks credential-ish.
 *  3. High-entropy runs (24+ chars, with a digit AND mixed case) — applied last.
 *
 * URL credential userinfo (`//user:pass@host`) is also stripped. Normal prose,
 * file paths, plain URLs, ISO timestamps and UUIDs are left untouched.
 */
export function redact(text: string): string {
  let s = text;

  // 0. Private key blocks (PEM / OpenSSH), including across newlines — redact()
  //    runs before newlines are collapsed, so the whole block is matched here.
  s = s.replace(/-----BEGIN[^-]*PRIVATE KEY-----[\s\S]*?-----END[^-]*PRIVATE KEY-----/g, "[REDACTED]");

  // 1. Known token prefixes followed by 8+ non-space chars.
  s = s.replace(/\b(?:sk-|ghp_|gho_|ghs_|ghr_|github_pat_|xoxb-|xoxp-|xoxa-|xapp-)\S{8,}/g, "[REDACTED]");
  // AWS access key ids: AKIA then 12+ alphanumerics.
  s = s.replace(/\bAKIA[A-Za-z0-9]{12,}/g, "[REDACTED]");
  // Google API keys: AIza then 35 url-safe chars.
  s = s.replace(/\bAIza[0-9A-Za-z_-]{35}\b/g, "[REDACTED]");
  // JSON Web Tokens: three base64url segments, header starting with eyJ.
  s = s.replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "[REDACTED]");
  // Bearer tokens: "Bearer " then 16+ non-space chars.
  s = s.replace(/\bBearer \S{16,}/g, "[REDACTED]");

  // 2. key=value / key: value with a credential-ish key and an 8+ char value.
  s = s.replace(
    /\b(api[_-]?key|token|secret|password|passwd|credential|auth)(\s*[=:]\s*)(\S{8,})/gi,
    "$1$2[REDACTED]"
  );

  // URL credential userinfo: //user:pass@host -> //[REDACTED]@host
  s = s.replace(/(\/\/)[^\s\/@]+:[^\s\/@]+@/g, "$1[REDACTED]@");

  // 3. High-entropy strings (applied last): 24+ chars from a base64-ish alphabet
  //    that contain at least one digit AND mixed case.
  //    '/' is deliberately excluded from the run alphabet so that file paths and
  //    URL paths break into short segments. As an extra guard, any candidate run
  //    sitting in a path/URL context (immediately preceded by '/') is skipped so
  //    long path/URL segments are never treated as secrets.
  s = s.replace(/[A-Za-z0-9+=_-]{24,}/g, (m: string, offset: number, full: string) => {
    if (offset > 0 && full[offset - 1] === "/") return m;
    const ok = /\d/.test(m) && /[a-z]/.test(m) && /[A-Z]/.test(m);
    return ok ? "[REDACTED]" : m;
  });

  return s;
}

/** Redact a field, collapse newlines to spaces, then optionally truncate. */
function reduceField(value: string | undefined, max?: number): string {
  let v = redact(value ?? "");
  v = v.replace(/[\r\n]+/g, " ");
  if (max !== undefined) v = v.slice(0, max);
  return v;
}

/**
 * Reduce a single session into a compact, deterministic text digest.
 * One header line plus one line per event, in original order.
 *
 * Only the most recent MAX_DIGEST_EVENTS events are kept so a pathologically
 * long session can't produce an unbounded digest (which is rewritten on every
 * watcher tick and replayed into scan prompts). The header — including the
 * start/end times computed from the *full* session — is always preserved.
 */
const MAX_DIGEST_EVENTS = 1000;

export function digestSession(record: SessionRecord): string {
  const header =
    `=== session ${reduceField(record.sessionId)} tool=${reduceField(record.tool)} ` +
    `cwd=${reduceField(record.cwd)} branch=${reduceField(record.branch ?? "-")} ` +
    `start=${reduceField(record.startedAt)} end=${reduceField(record.endedAt)}`;

  const lines: string[] = [header];

  const events =
    record.events.length > MAX_DIGEST_EVENTS
      ? record.events.slice(-MAX_DIGEST_EVENTS)
      : record.events;
  for (const e of events) {
    const t = reduceField(e.t);
    switch (e.kind) {
      case "user_msg":
        lines.push(`U ${t} ${reduceField(e.text, 200)}`);
        break;
      case "command":
        lines.push(`C ${t} ${reduceField(e.name)}`);
        break;
      case "tool_call":
        lines.push(`T ${t} ${reduceField(e.name)}: ${reduceField(e.summary, 100)}`);
        break;
      case "error":
        lines.push(`E ${t} ${reduceField(e.summary, 150)}`);
        break;
    }
  }

  return lines.join("\n");
}

/**
 * Strip dead weight before sending digests to the LLM: per-event ISO timestamps
 * (the model cites evidence by event index, not by time) and runs of spaces.
 * Saves a meaningful share of scan tokens with no loss of signal. Stored digests
 * keep their timestamps; this only shapes the prompt payload.
 */
export function compactDigestForPrompt(text: string): string {
  return text
    .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?/g, "")
    .replace(/[ \t]{2,}/g, " ");
}

export interface DigestHeader {
  sessionId: string;
  tool: string;
  cwd: string;
  endedAtMs?: number; // undefined when the header has no parseable end= time
}

/**
 * Parse the first (header) line of a digest back into its fields. Kept next to
 * digestSession so the read and write formats stay in sync. Single-token fields
 * (tool/end) read up to the next space; cwd reads greedily up to the next
 * ` key=` field so a path containing spaces survives intact.
 */
export function parseDigestHeader(firstLine: string): DigestHeader {
  const field = (key: string): string => {
    const match = firstLine.match(new RegExp(`\\b${key}=(\\S+)`));
    return match ? match[1] : "";
  };

  const sessionId = firstLine.match(/^=== session (\S+)/)?.[1] ?? "";
  // cwd may contain spaces; stop only at the next ` <key>=` token or line end.
  const cwd = firstLine.match(/\bcwd=(.*?)(?=\s+\w+=|$)/)?.[1] ?? "";
  const end = field("end");
  const endedAt = end ? new Date(end).getTime() : Number.NaN;

  return {
    sessionId,
    tool: field("tool"),
    cwd,
    endedAtMs: Number.isNaN(endedAt) ? undefined : endedAt
  };
}

/**
 * Reduce many sessions, sorted by startedAt (then sessionId for full
 * determinism), separated by a blank line.
 */
export function digestSessions(records: SessionRecord[]): string {
  const sorted = [...records].sort((a, b) => {
    if (a.startedAt < b.startedAt) return -1;
    if (a.startedAt > b.startedAt) return 1;
    if (a.sessionId < b.sessionId) return -1;
    if (a.sessionId > b.sessionId) return 1;
    return 0;
  });
  return sorted.map(digestSession).join("\n\n");
}
