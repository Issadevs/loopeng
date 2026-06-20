import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { loadConfig, loopengHome } from "./state.js";

export type EventKind =
  | "digest"
  | "scan"
  | "propose"
  | "approve"
  | "dismiss"
  | "snooze"
  | "install"
  | "uninstall"
  | "pause"
  | "resume"
  | "spawn"
  | "error";

export interface LoopEngEvent {
  t: string; // ISO timestamp (callers pass their injected clock)
  kind: EventKind;
  msg: string; // human-readable single line
}

function logDir(): string {
  return join(loopengHome(), "log");
}

function eventsPath(): string {
  return join(logDir(), "events.jsonl");
}

export function appendEvent(kind: EventKind, msg: string, t: string): void {
  const dir = logDir();
  mkdirSync(dir, { recursive: true });

  const path = eventsPath();
  const event: LoopEngEvent = { t, kind, msg: msg.replace(/[\r\n]+/g, " ") };
  appendFileSync(path, `${JSON.stringify(event)}\n`, "utf8");

  let size: number;
  try {
    size = statSync(path).size;
  } catch {
    return;
  }

  const config = loadConfig();
  if (size > config.eventsMaxBytes) {
    const lines = readFileSync(path, "utf8").split("\n").filter((line) => line.length > 0);
    const kept = lines.slice(-config.eventsKeepLines);
    writeFileSync(path, `${kept.join("\n")}\n`, "utf8");
  }
}

export function readEvents(limit: number): LoopEngEvent[] {
  const path = eventsPath();
  if (!existsSync(path)) {
    return [];
  }

  const lines = readFileSync(path, "utf8").split("\n").filter((line) => line.length > 0);
  const events: LoopEngEvent[] = [];

  for (const line of lines) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }

    if (
      typeof parsed === "object" &&
      parsed !== null &&
      typeof (parsed as LoopEngEvent).t === "string" &&
      typeof (parsed as LoopEngEvent).kind === "string" &&
      typeof (parsed as LoopEngEvent).msg === "string"
    ) {
      events.push(parsed as LoopEngEvent);
    }
  }

  return limit >= 0 ? events.slice(-limit) : events;
}
