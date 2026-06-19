<p align="center">
  <img src="docs/loopeng-header.svg" alt="loopEng" width="100%">
</p>

<p align="center">
  <strong>loopEng watches what you do by hand in your terminal and turns the steps you keep repeating into callable MCP tools — so your AI agents can do them for you.</strong>
</p>

---

## What is loopEng?

loopEng is a **local meta-agent** that runs quietly in your terminal alongside Claude Code and Codex. It:

1. **Watches** your coding sessions as they happen.
2. **Finds** the workflows you keep doing by hand.
3. **Proposes** them to you in a terminal dashboard.
4. On your approval, **turns each one into**:
   - a **loop** — `loop.md` operating instructions wired into Claude Code or Codex, and
   - a **callable MCP tool** — the same workflow as a parameterized command sequence your agents can invoke directly.

You review proposals. You approve the ones that make sense. Everything stays on your machine — the only LLM calls go through your own `claude -p` binary. loopEng never phones home.

> *"True productivity isn't typing faster; it's stopping the need to type the same thing twice."*

---

## How it works

loopEng is a small local pipeline that runs continuously in the background:

```
Claude Code / Codex sessions
       │
       ▼
  [watcher]  — a launchd daemon notices each new session transcript
       │
       ▼
  [digester] — compresses + redacts each session to a compact text digest
       │
       ▼
  [engine]   — sends digests to your own `claude -p`, looks for recurring patterns
       │
       ▼
  [inbox]    — strong candidates land as proposals; you review and approve
       │
       ├──▶ [loop]      — loop.md + trigger + manifest wired into Claude Code / Codex
       │
       └──▶ [mcp tool]  — the same workflow as a callable tool on the loopeng-tools server
```

Everything above runs on your machine. The engine uses your own Claude credits — no separate service, no subscription, no cloud component.

---

## Install

```bash
curl -fsSL https://raw.githubusercontent.com/issadevs/loopeng/main/install.sh | bash
```

The installer:
- clones the repo to `~/.loopeng-app`, runs `npm install` + `npm run build`, and links the `loopeng` binary to your PATH,
- installs the Fable 5 prompt to `~/.loopeng/prompts/fable.md` and the `/fable` command to `~/.claude/commands/fable.md`.

Re-running the same command updates an existing install to the latest version.

Then finish setup:

```bash
loopeng setup
```

`loopeng setup` writes `~/.loopeng/config.json`, installs a `SessionStart` trigger hook into `~/.claude/settings.json`, and installs + loads a launchd daemon (`com.loopeng.daemon`).

Options:

```bash
loopeng setup --companion manual   # configure companion mode (auto | manual | off)
loopeng setup --no-daemon          # configure without the background daemon
```

**Requirements:** Node ≥ 20, git, the Claude Code CLI (`claude`) in your PATH, macOS (the daemon uses launchd; Windows/Linux support is on the roadmap).

---

## The dashboard

```bash
loopeng
```

Running `loopeng` with no arguments opens the full-terminal hub:

![loopeng dashboard](docs/dashboard.png)

The **header** shows your agent (loopEng) with live status: sessions watched · daemon state · today's token spend vs cap.

Three panels:

- **inbox** — pending proposals. Select one to see its summary, estimated impact, evidence count, and confidence score.
- **loops** — your installed loops, with trigger kind and target tool.
- **activity** — a scrolling log of everything loopEng has done in the background.

Keys:

| Key | Action |
|-----|--------|
| `tab` | Cycle focus: inbox → loops → activity |
| `↑` / `k`, `↓` / `j` | Move within the focused panel |
| `a` | Approve the selected proposal (confirm `y` / `n`) |
| `d` | Dismiss the selected proposal (confirm `y` / `n`) |
| `z` | Snooze the selected proposal for 7 days |
| `x` | Uninstall the selected loop (confirm `y` / `n`) |
| `s` | Trigger a scan now |
| `p` | Pause / resume the daemon |
| `q` | Quit |

The dashboard resizes with your terminal. At **60×16** and above it uses the full two-column layout; in tighter panes it switches to a compact one-panel view. In an interactive terminal, it uses a restrained color theme for status, focus, and actions; logs and non-TTY output stay plain, and `NO_COLOR=1` disables color.

---

## Commands

| Command | What it does |
|---------|--------------|
| `loopeng` | Open the full-terminal dashboard |
| `loopeng review` | Open the dashboard focused on the proposal inbox |
| `loopeng companion` | Alias for the bare `loopeng` command |
| `loopeng setup [--companion <mode>] [--no-daemon]` | Initialize config, trigger hook, and daemon |
| `loopeng scan` | Analyze local digests and surface new proposals now |
| `loopeng list` | List installed loops |
| `loopeng uninstall <id>` | Remove a loop and everything it installed |
| `loopeng pause` / `loopeng resume` | Pause / resume the background daemon |
| `loopeng status` | Show daemon state, today's token spend, and pending proposal count |
| `loopeng tools` | List the callable MCP tools generated from your workflows |
| `loopeng tools-register` | Register the `loopeng-tools` MCP server in Claude Code (`~/.claude.json`) |
| `loopeng mcp-tools` | Run the `loopeng-tools` MCP server (stdio) |
| `loopeng mcp` | Run loopEng's control-surface MCP server (stdio) |
| `loopeng mark` | Drop a session marker (used by the trigger hook) |
| `loopeng daemon` | Run the watcher in the foreground |

---

## What an approved proposal produces

Each approved proposal becomes a **bundle** at `~/.loopeng/bundles/<id>/`:

```
loop.md          — operating instructions an agent reads and follows
trigger.json     — schedule, hook, or manual trigger metadata
manifest.json    — evidence, target tool, and every path the install touched
tool.json        — the workflow as a callable MCP tool (best-effort; see below)
state/           — loop-local state (persists across runs)
```

`manifest.json` records every path the install created, which is what makes `loopeng uninstall <id>` exact — it removes only those paths, with no guesswork.

The `loop.md` is generated by a **maker → checker** pass: the maker writes six fixed sections (Responsibility, Trigger & cadence, Procedure, Verification, Convergence, Escalation) plus a trigger block, and the checker rejects vague verification, missing caps, or invented tools before the bundle is written.

---

## From workflow to callable MCP tool

A `loop.md` is prose an agent **reads and follows**. The next step is a tool an agent **calls and runs**. On approval, loopEng also tries to synthesize a `tool.json` — the same workflow as a parameterized sequence of `argv` commands — and exposes it on the **`loopeng-tools`** MCP server.

The synthesis is **grounded in what you actually did**:

- loopEng resolves the proposal's evidence back into the **real command lines** from your sessions,
- infers parameters from the tokens that **varied across runs** (e.g. a branch name),
- and a **deterministic gate rejects any step whose command you were never observed running** — so a generated tool can't invent `kubectl` because the model felt like it.

```bash
loopeng tools            # list the callable tools loopEng has generated
loopeng tools-register   # register the loopeng-tools server in Claude Code
loopeng mcp-tools        # run the loopeng-tools MCP server (stdio)
```

Once registered, an agent session can call e.g. `deploy_staging(branch="main")` and loopEng runs the captured steps.

**Safety.** Generated tools never run through a shell. Each step is an `argv` array executed with `execFile`, and parameter values are substituted as single literal tokens — so a value like `main; rm -rf /` is passed verbatim as one argument, never interpreted. Each step runs with a timeout (120s) and bounded output. A tool exists only because **you** approved the proposal it came from.

---

## MCP servers

loopEng ships two MCP servers, both stdio:

### `loopeng mcp` — control surface

Lets an agent drive loopEng itself.

- **Tools:** `proposals_list`, `proposals_get`, `proposals_approve`, `proposals_dismiss`, `proposals_snooze`, `scan`, `loops_list`, `loops_uninstall`, `events`, `status`
- **Resources:** `loopeng://proposals/{id}`, `loopeng://events`, `loopeng://status`

### `loopeng mcp-tools` — your workflows as tools

Exposes every installed loop that has a `tool.json` as a callable tool. When none exist yet, it exposes a single `loopeng_tools_help` tool that explains how to generate one. `loopeng tools-register` adds it to `~/.claude.json` as:

```json
{ "mcpServers": { "loopeng-tools": { "command": "loopeng", "args": ["mcp-tools"] } } }
```

---

## Privacy

Transcripts stay on your machine. Always.

Before any digest is sent to your `claude -p` process, loopEng redacts:

- API keys and tokens with known prefixes (`sk-`, `ghp_`, `gho_`, `github_pat_`, `xoxb-`, `xoxp-`), AWS access key ids (`AKIA…`), and `Bearer` tokens
- `key=value` / `key: value` pairs where the key looks credential-ish (`password`, `secret`, `token`, `api_key`, …)
- URL credentials (`//user:pass@host`)
- High-entropy strings that look like secrets

The engine sends only compact, redacted digests to your own `claude -p`. loopEng does not contact any external service.

---

## Configuration & on-disk layout

Configuration lives at `~/.loopeng/config.json`:

```json
{
  "companion": "auto",
  "dailyTokenCap": 100000,
  "pollIntervalMin": 15
}
```

- **companion** — `auto` (open a companion window when work is found), `manual`, or `off`
- **dailyTokenCap** — the engine reserves an estimate before each scan and skips once the day's budget is spent
- **pollIntervalMin** — how often the daemon re-scans for new sessions

Everything loopEng writes lives under `~/.loopeng/`:

```
~/.loopeng/
├ config.json        — the config above
├ digests/           — one redacted text digest per session
├ proposals/         — one JSON file per proposal
├ bundles/<id>/      — generated bundles (loop.md, trigger.json, manifest.json, tool.json, state/)
├ registry/          — installed.json, dismissed.json
├ markers/           — session-start markers dropped by the trigger hook
├ prompts/fable.md   — the Fable 5 system prompt
└ log/               — events.jsonl, spend.json, watch.json, pattern-memory.txt
```

---

## /fable — Claude Fable 5 slash command

The installer drops a `/fable` slash command into `~/.claude/commands/`, available in **any** Claude Code session:

```
/fable <your prompt>
```

It routes your prompt through the full Claude Fable 5 system prompt and model, inline, without leaving your session or switching your model. Under the hood it spawns:

```
claude -p --model claude-fable-5 --system-prompt-file ~/.loopeng/prompts/fable.md
```

and returns the output inline.

---

## The never-guilt principle

loopEng may suggest automation, but it never shames you for ignoring, snoozing, or dismissing a proposal. A quiet tool beats a nagging one. Your inbox, your call.

---

## Development

```bash
git clone https://github.com/issadevs/loopeng.git
cd loopeng
npm install
npm run build
npm link
```

Scripts:

```bash
npm run build       # tsc → dist/
npm run typecheck   # tsc --noEmit
npm test            # vitest run
npm run dev         # tsx src/index.ts
```

Run the full check the way CI does:

```bash
npm run typecheck && npm test
```

---

*loopEng is early software. It watches Claude Code and Codex sessions on macOS via launchd. Windows/Linux daemon support is on the roadmap.*
