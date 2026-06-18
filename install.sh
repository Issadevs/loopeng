#!/usr/bin/env bash
set -euo pipefail

REPO="https://github.com/issadevs/loopeng.git"
APP_INSTALL_DIR="$HOME/.loopeng-app"
BOLD="\033[1m"
DIM="\033[2m"
GREEN="\033[32m"
RED="\033[31m"
RESET="\033[0m"

info()  { echo -e "  ${DIM}$*${RESET}"; }
ok()    { echo -e "  ${GREEN}✓${RESET} $*"; }
fail()  { echo -e "  ${RED}✗${RESET} $*"; exit 1; }
header(){ echo -e "\n${BOLD}$*${RESET}"; }

header "loopEng installer"

# ── prerequisites ────────────────────────────────────────────────────────────

header "checking prerequisites"

if ! command -v git &>/dev/null; then
  fail "git is required but not found"
fi
ok "git found"

if ! command -v node &>/dev/null; then
  fail "Node.js ≥ 20 is required — install from https://nodejs.org"
fi

NODE_VERSION=$(node -e "process.stdout.write(process.versions.node)")
NODE_MAJOR_VERSION=$(echo "$NODE_VERSION" | cut -d. -f1)
if [ "$NODE_MAJOR_VERSION" -lt 20 ]; then
  fail "Node.js ≥ 20 required (found $NODE_VERSION)"
fi
ok "Node $NODE_VERSION"

if ! command -v npm &>/dev/null; then
  fail "npm is required but not found"
fi
ok "npm found"

# claude CLI is required at runtime but not at install time — warn only
if ! command -v claude &>/dev/null; then
  echo -e "  ${RED}!${RESET} claude CLI not found — install Claude Code before running loopeng setup"
fi

# ── clone or update ───────────────────────────────────────────────────────────

header "installing loopEng"

if [ -d "$APP_INSTALL_DIR/.git" ]; then
  info "found existing install at $APP_INSTALL_DIR — updating"
  git -C "$APP_INSTALL_DIR" pull --ff-only --quiet
  ok "updated to latest"
else
  info "cloning to $APP_INSTALL_DIR"
  git clone --quiet "$REPO" "$APP_INSTALL_DIR"
  ok "cloned"
fi

# ── build ────────────────────────────────────────────────────────────────────

info "installing dependencies"
npm install --prefix "$APP_INSTALL_DIR" --silent

info "building"
npm run build --prefix "$APP_INSTALL_DIR" --silent
ok "build complete"

# ── link binary ───────────────────────────────────────────────────────────────

info "linking loopeng binary"
npm link --prefix "$APP_INSTALL_DIR" "$APP_INSTALL_DIR" --silent 2>/dev/null || \
  npm link --prefix "$APP_INSTALL_DIR" --silent
ok "loopeng linked to $(command -v loopeng 2>/dev/null || echo 'PATH — open a new shell if not found')"

# ── fable slash command ───────────────────────────────────────────────────────

header "installing /fable command"

mkdir -p "$HOME/.loopeng/prompts"
cp "$APP_INSTALL_DIR/CLAUDE-FABLE-5.md" "$HOME/.loopeng/prompts/fable.md"
ok "fable prompt → ~/.loopeng/prompts/fable.md"

mkdir -p "$HOME/.claude/commands"
cp "$APP_INSTALL_DIR/commands/fable.md" "$HOME/.claude/commands/fable.md"
ok "/fable command → ~/.claude/commands/fable.md"

# ── done ──────────────────────────────────────────────────────────────────────

header "done"
echo ""
echo -e "  Run ${BOLD}loopeng setup${RESET} to finish configuration."
echo -e "  Run ${BOLD}loopeng${RESET} to open the dashboard."
echo -e "  Use ${BOLD}/fable <prompt>${RESET} in any Claude Code session to route through Fable 5."
echo ""
