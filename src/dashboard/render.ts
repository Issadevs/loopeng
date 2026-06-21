import type { DashboardState, Focus, MessageTone, Mood } from "./state.js";
import { deriveMood, messageTone } from "./state.js";

export const FULL_LAYOUT_MIN_COLS = 60;
export const FULL_LAYOUT_MIN_ROWS = 16;

// Full-layout row budget. The body (inbox/loops) gets whatever is left after the
// fixed chrome and the activity feed, so changing ACTIVITY_ROWS re-flows the
// layout on its own instead of silently desyncing from a hardcoded subtraction.
const ACTIVITY_ROWS = 4;
const CHROME_ROWS = 8; // top border, 3 header lines, panel + activity titles, footer, bottom border

export interface RenderOptions {
  color?: boolean;
}

export function renderDashboard(
  s: DashboardState,
  cols: number,
  rows: number,
  options: RenderOptions = {}
): string {
  if (cols < FULL_LAYOUT_MIN_COLS || rows < FULL_LAYOUT_MIN_ROWS) {
    return withTheme(renderCompactDashboard(s, cols, rows), s, options);
  }

  const widths = columnWidths(cols);
  const bodyRows = Math.max(0, rows - CHROME_ROWS - ACTIVITY_ROWS);
  const critter = critterArt(deriveMood(s), s.moodFrame);

  const body = s.help
    ? helpBodyLines(cols, bodyRows)
    : bodyLines(s, widths, bodyRows);

  const lines: string[] = [
    topBorder(cols),
    boxedLine(` ${critter[0]}  ${statusText(s)}`, cols),
    boxedLine(` ${critter[1]}  ${headerMessage(s)}`, cols),
    boxedLine(` ${critter[2]}`, cols),
    s.help ? helpTitleLine(cols) : panelTitleLine(s, widths, cols),
    ...body,
    activityTitleLine(s.focus, cols),
    ...activityLines(s, cols),
    boxedLine(footerText(s), cols),
    bottomBorder(cols)
  ];

  return withTheme(normalizeLines(lines, cols, rows).join("\n"), s, options);
}

function renderCompactDashboard(s: DashboardState, cols: number, rows: number): string {
  if (rows <= 0 || cols <= 0) return "";
  if (rows === 1) return fit("loopEng", cols);

  const slots = Math.max(0, rows - 2);
  const inner: string[] = [
    boxedLine(` loopEng ${compactStatusText(s)}`, cols),
    boxedLine(` ${compactHeaderMessage(s)}`, cols),
    compactTitleLine(s.focus, cols),
    ...compactFocusedLines(s, Math.max(0, cols - 2), slots)
  ];

  const visibleInner =
    slots >= 4
      ? [...inner.slice(0, slots - 1), boxedLine(compactFooterText(s), cols)]
      : inner.slice(0, slots);

  return normalizeLines([topBorder(cols), ...visibleInner, bottomBorder(cols)], cols, rows).join("\n");
}

function topBorder(cols: number): string {
  const prefix = "╭─ loopEng ";
  return fit(prefix + "─".repeat(Math.max(0, cols - prefix.length - 1)) + "╮", cols);
}

function bottomBorder(cols: number): string {
  return fit(`╰${"─".repeat(Math.max(0, cols - 2))}╯`, cols);
}

function boxedLine(content: string, cols: number): string {
  return fit(`│${fit(content, Math.max(0, cols - 2))}│`, cols);
}

function panelTitleLine(s: DashboardState, widths: { left: number; right: number }, cols: number): string {
  const inboxTitle = `${s.focus === "inbox" ? "[inbox]" : "inbox"} (${s.data.proposals.length}) `;
  const loopsTitle = `${s.focus === "loops" ? "[loops]" : "loops"} (${s.data.loops.length}) `;
  return fit(
    `├${titleSegment(inboxTitle, widths.left)}┬${titleSegment(loopsTitle, widths.right)}┤`,
    cols
  );
}

function helpTitleLine(cols: number): string {
  return fit(`├${titleSegment("[help] keyboard shortcuts ", Math.max(0, cols - 2))}┤`, cols);
}

function helpBodyLines(cols: number, count: number): string[] {
  const width = Math.max(0, cols - 2);
  const col = Math.max(0, width - 4);
  const pad = "  ";

  const entries: [string, string][] = [
    ["[tab]      ", "switch panel  inbox → loops → activity"],
    ["[↑↓] [j/k] ", "navigate items / scroll activity"],
    ["[a]        ", "approve selected proposal              (inbox)"],
    ["[d]        ", "dismiss selected proposal              (inbox)"],
    ["[z]        ", "snooze proposal for 7 days             (inbox)"],
    ["[x]        ", "uninstall selected loop                (loops)"],
    ["[s]        ", "scan for new patterns                  (all)"],
    ["[p]        ", "pause / resume the daemon              (all)"],
    ["[h] or [?] ", "toggle this help overlay               (all)"],
    ["[q]        ", "quit loopEng dashboard                 (all)"],
    ["[y] / [n]  ", "confirm / cancel action prompt         (confirm)"],
    ["[esc]      ", "cancel / close overlay"],
  ];

  const rendered: string[] = entries.map(([key, desc]) =>
    fit(`${pad}${fit(key, 12)} ${fit(desc, col - 14)}`, width)
  );

  return fitToCount(["", ...rendered, ""], count).map((line) => boxedLine(line, cols));
}

function activityTitleLine(focus: Focus, cols: number): string {
  const title = `${focus === "activity" ? "[activity]" : "activity"} `;
  return fit(`├${titleSegment(title, Math.max(0, cols - 2))}┤`, cols);
}

function compactTitleLine(focus: Focus, cols: number): string {
  return fit(`├${titleSegment(`[${focus}] `, Math.max(0, cols - 2))}┤`, cols);
}

function titleSegment(title: string, width: number): string {
  return fit(`─ ${title}${"─".repeat(Math.max(0, width - title.length - 2))}`, width);
}

function bodyLines(
  s: DashboardState,
  widths: { left: number; right: number },
  count: number
): string[] {
  const left = inboxLines(s, widths.left, count);
  const right = loopLines(s, widths.right, count);

  return Array.from({ length: count }, (_, index) => {
    return `│${fit(left[index] ?? "", widths.left)}│${fit(right[index] ?? "", widths.right)}│`;
  });
}

function inboxLines(s: DashboardState, width: number, count: number): string[] {
  if (count <= 0) return [];
  if (s.data.proposals.length === 0) return [fit("(no proposals — press s to scan)", width)];

  const selected = selectedProposal(s);
  const list = s.data.proposals.slice(0, 4).map((proposal, index) => {
    const marker = index === s.inboxIndex ? "▶ " : "  ";
    return fit(`${marker}${proposal.candidate.id}`, width);
  });
  const detail = proposalDetailLines(selected, width, { compact: false }).map((line) => fit(line, width));

  return fitToCount([...list, "", ...detail], count);
}

function loopLines(s: DashboardState, width: number, count: number): string[] {
  if (count <= 0) return [];
  if (s.data.loops.length === 0) return [fit("(none installed yet)", width)];

  return fitToCount(
    s.data.loops.map((loop, index) => {
      const marker = index === s.loopsIndex ? "▶ " : "  ";
      return fit(`${marker}${loop.id} · ${loop.kind} · ${loop.tool}`, width);
    }),
    count
  );
}

// Short 3-char kind badges for the activity feed.
const EVENT_KIND_BADGE: Record<string, string> = {
  digest:    "dig",
  scan:      "scn",
  propose:   "prp",
  approve:   "apr",
  dismiss:   "dis",
  snooze:    "snz",
  install:   "ins",
  uninstall: "del",
  pause:     "pse",
  resume:    "run",
  spawn:     "spn",
  error:     "err",
};

function activityLines(s: DashboardState, cols: number): string[] {
  const width = Math.max(0, cols - 2);
  const events = s.data.events;
  const start = Math.max(0, events.length - ACTIVITY_ROWS - s.activityScroll);
  const visible = events.slice(start, start + ACTIVITY_ROWS);

  return Array.from({ length: ACTIVITY_ROWS }, (_, index) => {
    const event = visible[index];
    if (!event) return boxedLine("", cols);
    const badge = EVENT_KIND_BADGE[event.kind] ?? event.kind.slice(0, 3);
    return boxedLine(`${event.t.slice(11, 16)} [${badge}] ${event.msg}`, cols);
  }).map((line) => fit(line, width + 2));
}

function compactFocusedLines(s: DashboardState, width: number, slots: number): string[] {
  const count = Math.max(0, slots - 4);

  switch (s.focus) {
    case "inbox":
      return compactInboxLines(s, width, count).map((line) => boxedLine(line, width + 2));
    case "loops":
      return compactLoopLines(s, width, count).map((line) => boxedLine(line, width + 2));
    case "activity":
      return compactActivityLines(s, width, count).map((line) => boxedLine(line, width + 2));
  }
}

function compactInboxLines(s: DashboardState, width: number, count: number): string[] {
  if (count <= 0) return [];
  if (s.data.proposals.length === 0) return [fit("(no proposals)", width)];

  const selected = selectedProposal(s);
  const position = `${s.inboxIndex + 1}/${s.data.proposals.length}`;
  return fitToCount(
    [
      fit(`${position} ${selected.candidate.id}`, width),
      ...proposalDetailLines(selected, width, { compact: true }).map((line) => fit(line, width))
    ],
    count
  );
}

function compactLoopLines(s: DashboardState, width: number, count: number): string[] {
  if (count <= 0) return [];
  if (s.data.loops.length === 0) return [fit("(none installed)", width)];

  const selected = s.data.loops[s.loopsIndex] ?? s.data.loops[0];
  const position = `${s.loopsIndex + 1}/${s.data.loops.length}`;
  return fitToCount(
    [
      fit(`${position} ${selected.id}`, width),
      fit(`kind: ${selected.kind}`, width),
      fit(`tool: ${selected.tool}`, width)
    ],
    count
  );
}

function compactActivityLines(s: DashboardState, width: number, count: number): string[] {
  if (count <= 0) return [];

  const events = s.data.events;
  const start = Math.max(0, events.length - count - s.activityScroll);
  const visible = events.slice(start, start + count);
  if (visible.length === 0) return [fit("(no activity yet)", width)];

  return fitToCount(
    visible.map((event) => {
      const badge = EVENT_KIND_BADGE[event.kind] ?? event.kind.slice(0, 3);
      return fit(`${event.t.slice(11, 16)} [${badge}] ${event.msg}`, width);
    }),
    count
  );
}

function selectedProposal(s: DashboardState) {
  return s.data.proposals[s.inboxIndex] ?? s.data.proposals[0];
}

function proposalDetailLines(
  proposal: DashboardState["data"]["proposals"][number],
  width: number,
  options: { compact: boolean }
): string[] {
  const evidence = options.compact
    ? `evidence: ${proposal.candidate.occurrences}`
    : `evidence: ${proposal.candidate.occurrences} sessions`;
  const confidence = options.compact
    ? `confidence: ${Math.round(proposal.candidate.confidence * 100)}%`
    : `confidence: ${confidenceBar(proposal.candidate.confidence)}`;

  return [
    ...wrapText(proposal.candidate.summary, width),
    `impact: ${proposal.candidate.impactEstimate}`,
    evidence,
    confidence
  ];
}

function scopeLabel(s: DashboardState): string {
  return s.data.scope === "project" ? "this project" : "all projects";
}

// What's actually watching. The background launchd daemon and the in-process
// watcher (live while the dashboard is open) are different things — show "live"
// when the dashboard is watching even though no daemon is installed, so "✗"
// never reads as "nothing is listening".
function watchStatus(s: DashboardState): string {
  if (s.data.daemon === "running") return "daemon ✓";
  if (s.data.daemon === "paused") return "daemon paused";
  if (s.live) return "live ●";
  return "daemon ✗";
}

function compactWatchStatus(s: DashboardState): string {
  if (s.data.daemon === "running") return "run";
  if (s.data.daemon === "paused") return "paused";
  if (s.live) return "live";
  return "off";
}

function statusText(s: DashboardState): string {
  const count = `${s.data.sessions} session${s.data.sessions === 1 ? "" : "s"}`;
  return `watching ${count} in ${scopeLabel(s)} · ${watchStatus(s)} · spend ${s.data.spendToday}/${s.data.spendCap}`;
}

function compactStatusText(s: DashboardState): string {
  const scope = s.data.scope === "project" ? "proj" : "all";
  return `${s.data.sessions} sess (${scope}) | ${compactWatchStatus(s)} | ${s.data.spendToday}/${s.data.spendCap}`;
}

// A brand-new user: nothing watched, nothing proposed, nothing installed.
function isFreshStart(s: DashboardState): boolean {
  return (
    s.data.sessions === 0 &&
    s.data.proposals.length === 0 &&
    s.data.loops.length === 0
  );
}

function headerMessage(s: DashboardState): string {
  if (s.confirm) return `${s.confirm.action} "${s.confirm.targetId}"? [y]es [n]o`;
  if (s.busy) return `${s.busy}${".".repeat((s.spinnerFrame % 3) + 1)}`;
  if (s.flash) return s.flash;
  if (s.data.proposals.length > 0) return `✨ ${s.data.proposals.length} loop idea(s) waiting`;
  if (s.data.tools.length > 0) return `👀 detected ${s.data.tools.join(" + ")}`;
  if (isFreshStart(s)) return "👋 use Claude Code or Codex — loopEng spots loops to automate";
  return "all quiet — your loops have it covered";
}

function compactHeaderMessage(s: DashboardState): string {
  if (s.confirm) return `${s.confirm.action} "${s.confirm.targetId}"?`;
  if (s.busy) return `${s.busy}${".".repeat((s.spinnerFrame % 3) + 1)}`;
  if (s.flash) return s.flash;
  if (s.data.proposals.length > 0) return `${s.data.proposals.length} loop idea(s) waiting`;
  if (s.data.tools.length > 0) return `👀 ${s.data.tools.join(" + ")}`;
  if (isFreshStart(s)) return "👋 code to get started";
  return "all quiet";
}

function footerText(s: DashboardState): string {
  if (s.help) return "[esc/h] close help";
  if (s.confirm) return "[y]es [n]o";
  if (s.busy) return `${s.busy}… [q]uit`;

  switch (s.focus) {
    case "inbox":
      return "[tab]panel [↑↓]move [a]pprove [d]ismiss [z]snooze [s]can [p]ause [h]elp [q]uit";
    case "loops":
      return "[tab]panel [↑↓]move [x]uninstall [s]can [p]ause [h]elp [q]uit";
    case "activity":
      return "[tab]panel [↑↓]scroll [s]can [p]ause [h]elp [q]uit";
  }
}

function compactFooterText(s: DashboardState): string {
  if (s.help) return "[esc/h] close";
  if (s.confirm) return "[y]es [n]o";
  if (s.busy) return `${s.busy} [q]uit`;
  return "[tab] [j/k] [s]can [p]ause [h]elp [q]uit";
}

// The mascot is the loopEng creature from the logo: cream ears, amber eyes, a
// small mouth, rounded feet. Every frame is a fixed 9-column block whose ears,
// eyes, and feet corners align on the same two columns, so the face reads as
// one tidy, balanced shape. The mouth carries the mood — a smile on good news,
// a frown when something fails:
//
//     ∧   ∧
//    (◕ ◡ ◕)
//     ╰───╯
const EARS = "  ∧   ∧  ";
const EARS_SPARK = (frame: number): string =>
  frame % 2 === 0 ? "✦ ∧   ∧ ✦" : "✧ ∧   ∧ ✧";
const FEET = "  ╰───╯  ";

// Compose the 9-wide face line from single-glyph eyes + mouth, centered so the
// eyes always land on the same columns as the ears and feet above/below.
function face(eyeL: string, mouth: string, eyeR: string): string {
  return ` (${eyeL} ${mouth} ${eyeR}) `;
}

function critterArt(mood: Mood, frame: number): [string, string, string] {
  switch (mood) {
    case "idle": {
      // calm content eyes with a slow blink every 16 frames
      const eye = frame % 16 >= 14 ? "─" : "◕";
      return [EARS, face(eye, "◡", eye), FEET];
    }
    case "sleepy": {
      // eyes shut, a drowsy z drifting above the right ear
      const z = [" ", "z", " ", "Z"][Math.floor(frame / 2) % 4];
      return [`  ∧   ∧ ${z}`, face("─", "·", "─"), FEET];
    }
    case "perky":
      // bright eyes, sparkles breathing in and out beside the ears
      return [EARS_SPARK(frame), face("◕", "▿", "◕"), FEET];
    case "attentive":
      // wide alert eyes, focused
      return [EARS, face("◉", "‿", "◉"), FEET];
    case "celebrate":
      // good news! happy squint + a big smile, sparkles all around
      return [EARS_SPARK(frame), face("^", "⌣", "^"), FEET];
    case "grumpy":
      // bad news — furrowed brows and a little frown, cross but cute
      return [EARS, face("ò", "⌢", "ó"), FEET];
    case "working": {
      // spinner eyes while a loop is being worked
      const sp = (["◐", "◓", "◑", "◒"] as const)[frame % 4];
      return [EARS, face(sp, "·", sp), FEET];
    }
  }
}

function columnWidths(cols: number): { left: number; right: number } {
  const interior = Math.max(0, cols - 3);
  const left = Math.floor(interior * 0.55);
  return { left, right: interior - left };
}

function wrapText(text: string, width: number): string[] {
  if (width <= 0) return [""];

  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [""];

  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    if (word.length > width) {
      if (current) {
        lines.push(current);
        current = "";
      }
      for (let start = 0; start < word.length; start += width) {
        lines.push(word.slice(start, start + width));
      }
      continue;
    }

    const next = current ? `${current} ${word}` : word;
    if (next.length <= width) {
      current = next;
    } else {
      lines.push(current);
      current = word;
    }
  }

  if (current) lines.push(current);
  return lines;
}

function fitToCount(lines: string[], count: number): string[] {
  return [...lines, ...Array.from({ length: Math.max(0, count - lines.length) }, () => "")].slice(0, count);
}

// A 0..1 confidence as a percentage plus a 10-cell bar, for quick scanning.
function confidenceBar(confidence: number): string {
  const clamped = Math.min(1, Math.max(0, confidence));
  const pct = Math.round(clamped * 100);
  const filled = Math.round(clamped * 10);
  return `${pct}% ${"█".repeat(filled)}${"·".repeat(10 - filled)}`;
}

function normalizeLines(lines: string[], cols: number, rows: number): string[] {
  return Array.from({ length: Math.max(0, rows) }, (_, index) => fit(lines[index] ?? "", cols));
}

function centerText(text: string, width: number): string {
  if (text.length >= width) return fit(text, width);
  const left = Math.floor((width - text.length) / 2);
  return `${" ".repeat(left)}${text}`;
}

function fit(text: string, width: number): string {
  if (width <= 0) return "";
  if (text.length > width) return text.slice(0, width);
  return text + " ".repeat(width - text.length);
}

// Terminal theme mirrors the loopEng design system (site/app/globals.css):
// warm charcoal canvas, amber/gold brand accent, sage green, slate blue, and
// cream text. Truecolor keeps the hex values exact across modern terminals.
const ANSI = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  border: "\x1b[38;2;58;54;45m", //    warm border     #3a362d  (between --border #2e2a24 and --border-bright #464034)
  brand: "\x1b[38;2;232;185;111m", // --amber-bright   #e8b96f
  good: "\x1b[38;2;143;174;126m", //  --green          #8fae7e
  warn: "\x1b[38;2;214;163;92m", //   --amber          #d6a35c
  bad: "\x1b[38;2;207;124;90m", //    terracotta       #cf7c5a
  info: "\x1b[38;2;125;156;192m", //  --blue           #7d9cc0
  soft: "\x1b[38;2;111;107;99m", //   muted terminal   #6f6b63  (darker than --text-muted #9a9487, closer to --text-dim #666156)
  highlight: "\x1b[38;2;232;185;111m" // --amber-bright #e8b96f
} as const;

function withTheme(rendered: string, s: DashboardState, options: RenderOptions): string {
  if (options.color !== true) return rendered;

  return rendered
    .split("\n")
    .map((line, index) => colorizeLine(line, index, s))
    .join("\n");
}

function colorizeLine(line: string, index: number, s: DashboardState): string {
  if (line.length === 0) return line;
  if (isBorderOnlyLine(line)) return colorizeBorderLine(line);
  if (line.startsWith("├")) return colorizeTitleLine(line);

  const content = line.slice(1, -1);
  const left = style(ANSI.border, line[0] ?? "");
  const right = style(ANSI.border, line[line.length - 1] ?? "");

  // Full-layout header rows carry the mascot in a fixed 10-column gutter
  // (leading space + 9-wide face). Color the creature on-brand — amber eyes,
  // bright sparkles — and let the rest of the row keep its own colors.
  if (index === 1 && content.includes("∧")) {
    return `${left}${colorizeCritter(content.slice(0, 10))}${colorizeStatus(content.slice(10))}${right}`;
  }
  if (index === 2 && /^  \(.{5}\)/.test(content)) {
    return `${left}${colorizeCritter(content.slice(0, 10))}${colorizeMessage(content.slice(10))}${right}`;
  }
  if (index === 1) return `${left}${colorizeStatus(content)}${right}`;
  if (index === 2) return `${left}${colorizeMessage(content)}${right}`;
  if (index === 3 && content.includes("╰")) {
    return `${left}${colorizeCritter(content)}${right}`;
  }
  if (isFooterContent(content)) {
    return `${left}${style(ANSI.soft, content)}${right}`;
  }

  if (isHelpBodyLine(content)) return `${left}${colorizeHelpLine(content)}${right}`;

  return `${left}${colorizeBody(content)}${right}`;
}

// The creature outline (ears, parens, feet) stays cream/default; eyes and mouth
// glow amber; blush cheeks and sparkles get the brighter amber accent — the
// rosy, twinkly bits that make it cute.
function colorizeCritter(part: string): string {
  return part
    .replace(/[✦✧]/g, (m) => style(ANSI.highlight, m))
    .replace(/[◕◉◐◑◒◓▿◡‿⌣⌢òó·^]/g, (m) => style(ANSI.warn, m));
}

function isBorderOnlyLine(line: string): boolean {
  return /^[╭╰][─ loopEng]*[╮╯]$/.test(line);
}

// The framing rules are border-colored, but the "loopEng" wordmark tucked into
// the top rule is the brand and gets the amber treatment.
function colorizeBorderLine(line: string): string {
  if (!line.includes("loopEng")) return style(ANSI.border, line);
  return line
    .split(/(loopEng)/)
    .map((part) => (part === "loopEng" ? style(`${ANSI.bold}${ANSI.brand}`, part) : style(ANSI.border, part)))
    .join("");
}

function colorizeTitleLine(line: string): string {
  return line
    .replace(/\[[^\]]+\]/g, (match) => style(`${ANSI.bold}${ANSI.brand}`, match))
    .replace(/\b(inbox|loops|activity)\b/g, (match) => style(ANSI.info, match))
    .replace(/([╭╮╰╯├┤┬─]+)/g, (match) => style(ANSI.border, match));
}

function colorizeStatus(content: string): string {
  return content
    .replace(/loopEng/g, style(`${ANSI.bold}${ANSI.brand}`, "loopEng"))
    .replace(/daemon ✓/g, style(ANSI.good, "daemon ✓"))
    .replace(/daemon paused/g, style(ANSI.warn, "daemon paused"))
    .replace(/daemon ✗/g, style(ANSI.bad, "daemon ✗"))
    .replace(/live(?: ●)?/g, (match) => style(ANSI.good, match))
    .replace(/\brun\b/g, style(ANSI.good, "run"))
    .replace(/\bpaused\b/g, style(ANSI.warn, "paused"))
    .replace(/\boff\b/g, style(ANSI.bad, "off"))
    .replace(/spend \d+\/\d+/g, (match) => style(ANSI.soft, match));
}

// Colour the header message from its shared tone, so this never disagrees with
// the mascot's mood (deriveMood uses the same messageTone classifier).
const TONE_ANSI: Record<MessageTone, string> = {
  good: ANSI.good,
  bad: ANSI.bad,
  warn: ANSI.warn,
  muted: ANSI.soft,
  info: ANSI.info
};

function colorizeMessage(content: string): string {
  return style(TONE_ANSI[messageTone(content)], content);
}

// Map event kind badges to their ANSI color.
const EVENT_KIND_ANSI: Record<string, string> = {
  ins: ANSI.good,
  apr: ANSI.good,
  run: ANSI.good,
  prp: ANSI.warn,
  snz: ANSI.warn,
  pse: ANSI.warn,
  err: ANSI.bad,
  del: ANSI.bad,
  dis: ANSI.soft,
  dig: ANSI.soft,
  scn: ANSI.info,
  spn: ANSI.info,
};

function colorizeBody(content: string): string {
  if (content.trim().length === 0) return content;

  return content
    .replace(/▶/g, style(`${ANSI.bold}${ANSI.brand}`, "▶"))
    .replace(/\((no proposals|none installed|no activity yet)[^)]+\)/g, (match) =>
      style(ANSI.soft, match)
    )
    .replace(/\b(impact|evidence|confidence|kind|tool):/g, (match) =>
      style(ANSI.info, match)
    )
    .replace(/\b\d+\/\d+\b/g, (match) => style(ANSI.highlight, match))
    .replace(/\[([a-z]{2,4})\]/g, (match, badge: string) => {
      const color = EVENT_KIND_ANSI[badge];
      return color ? style(color, match) : style(ANSI.soft, match);
    });
}

function isFooterContent(content: string): boolean {
  return (
    content.includes("[y]es") ||
    content.includes("[tab]") ||
    content.includes("[q]uit") ||
    content.includes("[esc/h]")
  );
}

function isHelpBodyLine(content: string): boolean {
  return /^\s+\[[^\]]+\]\s/.test(content);
}

// Highlight the keybinding bracket pairs in amber, the description in muted.
function colorizeHelpLine(content: string): string {
  return content.replace(/(\[[^\]]+\])(.*?)(\([^)]+\))?$/, (_match, key, desc, panel) => {
    const coloredKey = style(`${ANSI.bold}${ANSI.brand}`, key as string);
    const coloredDesc = style(ANSI.soft, desc as string);
    const coloredPanel = panel ? style(ANSI.dim, panel as string) : "";
    return `${coloredKey}${coloredDesc}${coloredPanel}`;
  });
}

function style(code: string, text: string): string {
  if (text.length === 0) return text;
  return `${code}${text}${ANSI.reset}`;
}
