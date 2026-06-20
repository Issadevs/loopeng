import { existsSync } from "node:fs";
import { join } from "node:path";

import {
  daemonPlistPath,
  pauseAction,
  readCompanionState,
  resumeAction,
} from "../cli.js";
import {
  approveAction,
  bundleDirFor,
  dismissAction,
  scanAction,
  snoozeAction,
  uninstallAction,
  type CliDeps
} from "../actions.js";
import { getProposal, loadConfig, loopengHome, readJson, watchScope } from "../state.js";
import { readEvents } from "../events.js";
import { defaultContext, startWatcher } from "../watcher.js";
import { DAEMON_LABEL } from "../constants.js";
import { readBundleManifest, readTrigger } from "../installers/shared.js";
import {
  reduce,
  type DashboardData,
  type DashboardState,
  type Effect,
  type Focus,
  type LoopRow
} from "./state.js";
import { renderDashboard } from "./render.js";

// Assemble the live DashboardData from disk + launchctl. Pure read: performs
// no mutations.
export async function assembleData(deps: CliDeps): Promise<DashboardData> {
  const { proposals, sessions, tools } = readCompanionState(deps);

  const plist = daemonPlistPath(deps);
  let daemon: DashboardData["daemon"];
  if (!existsSync(plist)) {
    daemon = "not-installed";
  } else {
    const { code } = await deps.exec("launchctl", ["list", DAEMON_LABEL]);
    daemon = code === 0 ? "running" : "paused";
  }

  const spend = readJson<Record<string, number>>(join(loopengHome(), "log", "spend.json")) ?? {};
  const spendToday = spend[deps.now().slice(0, 10)] ?? 0;
  const spendCap = loadConfig().dailyTokenCap;

  const installed = readJson<string[]>(join(loopengHome(), "registry", "installed.json")) ?? [];
  const loops: LoopRow[] = installed.map((id) => {
    const dir = bundleDirFor(getProposal(id), id);
    try {
      const manifest = readBundleManifest(dir);
      return { id: manifest.loopId, kind: readTrigger(dir).kind, tool: manifest.tool };
    } catch {
      return { id, kind: "?", tool: "?" };
    }
  });

  const events = readEvents(50).map((e) => ({ t: e.t, kind: e.kind, msg: e.msg }));

  return { sessions, tools, scope: watchScope(), daemon, spendToday, spendCap, proposals, loops, events };
}

// A cheap fingerprint of the data that matters on screen, so the live refresh
// can skip re-rendering when nothing meaningful changed.
function dataSignature(d: DashboardData): string {
  return [
    d.sessions,
    d.tools.join("+"),
    d.daemon,
    d.spendToday,
    d.spendCap,
    d.proposals.map((p) => p.candidate.id).join(","),
    d.loops.map((l) => l.id).join(","),
    d.events.length,
    d.events[d.events.length - 1]?.t ?? ""
  ].join("|");
}

// Execute one reducer Effect against the real CLI actions and return the flash
// string to show afterward.
export async function dispatchEffect(deps: CliDeps, effect: Effect): Promise<string> {
  switch (effect.type) {
    case "approve": {
      const p = getProposal(effect.id);
      if (p === undefined) return `bundle "${effect.id}" not found`;
      const ar = await approveAction(deps, p);
      if (!ar.ok) return `approve failed: ${ar.reason}`;
      return `🌱 "${effect.id}" installed — it's off your plate now`;
    }

    case "dismiss": {
      const p = getProposal(effect.id);
      if (p === undefined) return `"${effect.id}" not found`;
      const dr = await dismissAction(deps, p);
      if (!dr.ok) return `dismiss failed: ${dr.reason}`;
      return `dismissed "${effect.id}"`;
    }

    case "snooze": {
      const p = getProposal(effect.id);
      if (p === undefined) return `"${effect.id}" not found`;
      const sr = await snoozeAction(deps, p);
      if (!sr.ok) return `snooze failed: ${sr.reason}`;
      return `snoozed "${effect.id}" for 7 days`;
    }

    case "uninstall": {
      const r = await uninstallAction(deps, effect.id);
      if (!r.ok) return `uninstall failed: ${r.reason}`;
      return `uninstalled "${effect.id}"`;
    }

    case "scan": {
      const captured: string[] = [];
      const sr = await scanAction({ ...deps, out: (line) => captured.push(line) });
      if (!sr.ok) return `scan failed: ${sr.reason}`;
      return captured.length > 0 ? captured[captured.length - 1] : "scan complete";
    }

    case "toggle-pause": {
      const data = await assembleData(deps);
      if (data.daemon === "running") {
        await pauseAction(deps);
        return "daemon paused";
      }
      await resumeAction(deps);
      return "daemon resumed";
    }
  }
}

// The interactive shell: raw-mode stdin, render loop, resize, clean exit.
// Resolves when the user quits.
export function runDashboard(deps: CliDeps, startFocus?: Focus): Promise<void> {
  return new Promise<void>((resolve) => {
    void (async () => {
      const data = await assembleData(deps);
      let state: DashboardState = {
        data,
        focus: startFocus ?? "inbox",
        inboxIndex: 0,
        loopsIndex: 0,
        activityScroll: 0,
        moodFrame: 0,
        spinnerFrame: 0
      };

      const isInteractive = process.stdin.isTTY === true && process.stdout.isTTY === true;
      const useColor =
        isInteractive && process.env.NO_COLOR === undefined && process.env.TERM !== "dumb";
      let busy = false;

      const render = (): void => {
        const cols = process.stdout.columns ?? 80;
        const rows = process.stdout.rows ?? 24;
        process.stdout.write("\x1b[H\x1b[2J" + renderDashboard(state, cols, rows, { color: useColor }));
      };

      if (!isInteractive) {
        const cols = process.stdout.columns ?? 80;
        const rows = process.stdout.rows ?? 24;
        process.stdout.write(`${renderDashboard(state, cols, rows)}\n`);
        resolve();
        return;
      }

      const tick = setInterval(() => {
        if (!state.busy) return;
        const next = reduce(state, { kind: "tick" });
        state = next.state;
        render();
      }, loadConfig().dashboardBusyTickMs);
      tick.unref();

      // Run the session watcher in-process while the dashboard is open, so
      // Claude Code and Codex sessions are picked up live without needing the
      // separate launchd daemon (this is what makes `npm run dev` "just work").
      // The dashboard is the foreground UI, so don't spawn the companion window.
      const watcher = startWatcher(defaultContext(), { spawnCompanion: false });
      state = { ...state, live: true }; // the dashboard is now watching in-process

      // Pull fresh data from disk on a short cadence so sessions the watcher
      // just digested (and any new proposals) show up on their own. Only
      // re-render when something actually changed, to avoid periodic flicker.
      let refreshing = false;
      let lastSig = dataSignature(data);
      const refresh = setInterval(() => {
        if (busy || state.busy || refreshing) return;
        refreshing = true;
        void assembleData(deps)
          .then((fresh) => {
            const sig = dataSignature(fresh);
            if (sig === lastSig) return;
            lastSig = sig;
            apply({ kind: "data", data: fresh });
            render();
          })
          .catch(() => {
            // A failing refresh must not disturb the UI — keep the last data.
          })
          .finally(() => {
            refreshing = false;
          });
      }, loadConfig().dashboardRefreshMs);
      refresh.unref();

      const onResize = (): void => render();

      // Restore the terminal: show the cursor and leave the alternate screen,
      // bringing back exactly what was on screen before the dashboard opened.
      // Idempotent, and also wired to process exit as a safety net so an
      // unexpected termination can't leave the terminal stuck in the TUI.
      let restored = false;
      const restoreTerminal = (): void => {
        if (restored) return;
        restored = true;
        process.stdout.write(CURSOR_SHOW + ALT_SCREEN_OFF);
      };
      process.once("exit", restoreTerminal);

      let cleanedUp = false;
      const cleanup = (): void => {
        if (cleanedUp) return;
        cleanedUp = true;
        clearInterval(tick);
        clearInterval(refresh);
        watcher.stop();
        process.stdout.removeListener("resize", onResize);
        process.stdin.removeListener("data", onData);
        process.stdin.setRawMode(false);
        process.stdin.pause();
        restoreTerminal();
      };

      const apply = (action: Parameters<typeof reduce>[1]): void => {
        const next = reduce(state, action);
        state = next.state;
      };

      const runEffect = async (effect: Effect): Promise<void> => {
        busy = true;
        apply({ kind: "busy", label: effect.type === "scan" ? "scanning" : "working" });
        render();
        try {
          const flash = await dispatchEffect(deps, effect);
          apply({ kind: "done", flash });
        } catch (err) {
          apply({
            kind: "done",
            flash: `error: ${err instanceof Error ? err.message : String(err)}`
          });
        } finally {
          try {
            const fresh = await assembleData(deps);
            apply({ kind: "data", data: fresh });
          } catch {
            // A failing refresh must not re-freeze the UI — keep the last data.
          }
          busy = false;
          render();
        }
      };

      const onData = (chunk: Buffer): void => {
        const key = normalizeKey(chunk.toString());
        if (key === "\x03") {
          cleanup();
          resolve();
          return;
        }
        if (key === null) return;
        if (busy) return;

        const next = reduce(state, { kind: "key", key });
        state = next.state;

        if (state.quit) {
          cleanup();
          resolve();
          return;
        }

        if (next.effect) {
          void runEffect(next.effect);
          return;
        }

        render();
      };

      process.stdin.setRawMode(true);
      process.stdin.resume();
      process.stdin.on("data", onData);
      process.stdout.on("resize", onResize);
      // Switch to the alternate screen + hide the cursor before the first paint.
      process.stdout.write(ALT_SCREEN_ON + CURSOR_HIDE);
      render();
    })();
  });
}

// Terminal control: render the dashboard on the alternate screen buffer (like
// vim / less / htop) so repaints update in place and never pollute the scroll-
// back. Without this, every spinner frame is left behind in history, which
// looks like the app is relaunching itself over and over.
const ALT_SCREEN_ON = "\x1b[?1049h";
const ALT_SCREEN_OFF = "\x1b[?1049l";
const CURSOR_HIDE = "\x1b[?25l";
const CURSOR_SHOW = "\x1b[?25h";

function normalizeKey(seq: string): string | null {
  switch (seq) {
    case "\x1b[A":
      return "up";
    case "\x1b[B":
      return "down";
    case "\x1b[C":
      return "right";
    case "\x1b[D":
      return "left";
    case "\x1b":
      return "esc";
    case "\r":
    case "\n":
      return "enter";
    case "\t":
      return "tab";
    case "\x03":
      return "\x03";
  }
  if (seq.length === 1 && seq >= "a" && seq <= "z") return seq;
  return null;
}
