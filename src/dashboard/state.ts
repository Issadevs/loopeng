import type { Proposal } from "../types.js";

export type Mood = "sleepy" | "idle" | "perky" | "attentive" | "celebrate" | "grumpy" | "working";
export type Focus = "inbox" | "loops" | "activity";

export interface EventRow { t: string; kind: string; msg: string; }
export interface LoopRow { id: string; kind: string; tool: string; }

export interface DashboardData {
  sessions: number;
  tools: string[]; // agents detected among active sessions, e.g. ["claude-code", "codex"]
  scope: "all" | "project"; // whether loopEng is watching the whole machine or one project
  daemon: "running" | "paused" | "not-installed";
  spendToday: number;
  spendCap: number;
  proposals: Proposal[];
  loops: LoopRow[];
  events: EventRow[];
}

export interface DashboardState {
  data: DashboardData;
  focus: Focus;
  inboxIndex: number;
  loopsIndex: number;
  activityScroll: number;
  moodFrame: number;
  spinnerFrame: number;
  flash?: string;
  confirm?: { action: "approve" | "dismiss" | "uninstall"; targetId: string };
  busy?: string;
  quit?: boolean;
  live?: boolean; // the in-process watcher is running (dashboard is watching live)
  help?: boolean; // help overlay is open
}

export type DashboardAction =
  | { kind: "key"; key: string }
  | { kind: "tick" }
  | { kind: "data"; data: DashboardData }
  | { kind: "busy"; label: string }
  | { kind: "done"; flash: string };

export type Effect =
  | { type: "approve"; id: string }
  | { type: "dismiss"; id: string }
  | { type: "snooze"; id: string }
  | { type: "uninstall"; id: string }
  | { type: "scan" }
  | { type: "toggle-pause" };

// The emotional tone of a status message. Single source of truth so the
// mascot's mood (here) and the message colour (render.ts) never disagree, and a
// reworded message only needs updating in one place instead of two regexes that
// silently drift apart.
export type MessageTone = "good" | "bad" | "warn" | "muted" | "info";

export function messageTone(text: string): MessageTone {
  // bad: an action didn't go through.
  if (/failed|error:|not found/.test(text)) return "bad";
  // good: a happy outcome — install banner, loop installed, daemon resumed,
  // scan complete. Word boundaries keep "uninstalled" out of "installed".
  if (text.startsWith("🌱") || /\b(installed|resumed|complete)\b/.test(text)) return "good";
  // warn: needs attention — waiting ideas, or a yes/no prompt.
  if (text.includes("loop idea") || text.includes("?")) return "warn";
  // muted: nothing going on.
  if (text.includes("all quiet")) return "muted";
  return "info";
}

export function deriveMood(s: DashboardState): Mood {
  if (s.flash) {
    const tone = messageTone(s.flash);
    if (tone === "bad") return "grumpy"; // bad news → cutely cross
    if (tone === "good") return "celebrate"; // good news → big smile
  }
  if (s.busy) return "working";
  if (s.confirm) return "attentive";
  if (s.data.proposals.length > 0) return "perky";
  if (s.data.sessions === 0) return "sleepy";
  return "idle";
}

export function reduce(
  s: DashboardState,
  a: DashboardAction
): { state: DashboardState; effect?: Effect } {
  switch (a.kind) {
    case "tick":
      return {
        state: {
          ...s,
          moodFrame: s.moodFrame + 1,
          spinnerFrame: s.spinnerFrame + 1
        }
      };

    case "data":
      return {
        state: {
          ...s,
          data: a.data,
          inboxIndex: clampIndex(s.inboxIndex, a.data.proposals.length),
          loopsIndex: clampIndex(s.loopsIndex, a.data.loops.length)
        }
      };

    case "busy":
      return { state: { ...s, busy: a.label } };

    case "done": {
      const { busy, ...rest } = s;
      void busy;
      return { state: { ...rest, flash: a.flash } };
    }

    case "key":
      return reduceKey(s, a.key);
  }
}

function reduceKey(s: DashboardState, key: string): { state: DashboardState; effect?: Effect } {
  if (s.confirm) {
    if (key === "y") {
      const confirm = s.confirm;
      const { confirm: _confirm, ...rest } = s;
      void _confirm;
      return { state: rest, effect: confirmToEffect(confirm) };
    }

    if (key === "n" || key === "esc") {
      const { confirm, ...rest } = s;
      void confirm;
      return { state: { ...rest, flash: "cancelled" } };
    }

    return { state: s };
  }

  if (key === "h" || key === "?") {
    return { state: { ...s, help: !s.help, flash: undefined } };
  }

  if (s.help) {
    if (key === "esc") return { state: { ...s, help: false } };
    return { state: s };
  }

  if (s.busy && !isBusyAllowedKey(key)) return { state: s };

  if (key === "q") return { state: { ...s, quit: true } };

  if (key === "tab") return { state: { ...s, focus: nextFocus(s.focus), flash: undefined } };

  if (isUp(key)) return { state: moveFocused(s, -1) };
  if (isDown(key)) return { state: moveFocused(s, 1) };

  if (s.busy) return { state: s };

  if (s.focus === "inbox" && s.data.proposals.length > 0) {
    const id = selectedProposalId(s);

    if (key === "a") {
      return { state: { ...s, confirm: { action: "approve", targetId: id } } };
    }

    if (key === "d") {
      return { state: { ...s, confirm: { action: "dismiss", targetId: id } } };
    }

    if (key === "z") return { state: s, effect: { type: "snooze", id } };
  }

  if (s.focus === "loops" && s.data.loops.length > 0 && key === "x") {
    return {
      state: {
        ...s,
        confirm: { action: "uninstall", targetId: s.data.loops[s.loopsIndex]?.id ?? "" }
      }
    };
  }

  if (key === "s") return { state: s, effect: { type: "scan" } };
  if (key === "p") return { state: s, effect: { type: "toggle-pause" } };

  return { state: s };
}

function selectedProposalId(s: DashboardState): string {
  return s.data.proposals[s.inboxIndex]?.candidate.id ?? "";
}

function confirmToEffect(confirm: NonNullable<DashboardState["confirm"]>): Effect {
  switch (confirm.action) {
    case "approve":
      return { type: "approve", id: confirm.targetId };
    case "dismiss":
      return { type: "dismiss", id: confirm.targetId };
    case "uninstall":
      return { type: "uninstall", id: confirm.targetId };
  }
}

function moveFocused(s: DashboardState, direction: -1 | 1): DashboardState {
  if (s.focus === "inbox") {
    return {
      ...s,
      inboxIndex: clampIndex(s.inboxIndex + direction, s.data.proposals.length),
      flash: undefined
    };
  }

  if (s.focus === "loops") {
    return {
      ...s,
      loopsIndex: clampIndex(s.loopsIndex + direction, s.data.loops.length),
      flash: undefined
    };
  }

  const nextScroll = direction === -1 ? s.activityScroll + 1 : s.activityScroll - 1;
  return {
    ...s,
    activityScroll: clamp(nextScroll, 0, maxActivityScroll(s.data.events.length)),
    flash: undefined
  };
}

function isBusyAllowedKey(key: string): boolean {
  return key === "q" || key === "tab" || isUp(key) || isDown(key);
}

function isUp(key: string): boolean {
  return key === "up" || key === "k";
}

function isDown(key: string): boolean {
  return key === "down" || key === "j";
}

function nextFocus(focus: Focus): Focus {
  switch (focus) {
    case "inbox":
      return "loops";
    case "loops":
      return "activity";
    case "activity":
      return "inbox";
  }
}

function clampIndex(index: number, length: number): number {
  return length <= 0 ? 0 : clamp(index, 0, length - 1);
}

function maxActivityScroll(eventsLength: number): number {
  return Math.max(0, eventsLength - 1);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
