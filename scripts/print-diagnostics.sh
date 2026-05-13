#!/usr/bin/env bash
set -euo pipefail

AGENT_USER="${MAGOCODE_AGENT_USER:-magocode}"

section() {
  printf '\n== %s ==\n' "$1"
}

if id "$AGENT_USER" >/dev/null 2>&1; then
  AGENT_HOME="$(getent passwd "$AGENT_USER" | cut -d: -f6)"
  UID_VALUE="$(id -u "$AGENT_USER")"
else
  AGENT_HOME="/home/$AGENT_USER"
  UID_VALUE=""
fi

INSTALL_DIR="$AGENT_HOME/magocode-agent"
CONFIG_PATH="$AGENT_HOME/.magocode.json"

section "System"
uname -a || true
if [ -r /etc/os-release ]; then
  . /etc/os-release
  printf 'Distribution: %s\n' "${PRETTY_NAME:-unknown}"
fi

section "Runtime"
command -v node >/dev/null 2>&1 && node --version || printf 'node: missing\n'
command -v npm >/dev/null 2>&1 && npm --version || printf 'npm: missing\n'
command -v git >/dev/null 2>&1 && git --version || printf 'git: missing\n'

section "Agent Files"
printf 'User: %s\n' "$AGENT_USER"
printf 'Home: %s\n' "$AGENT_HOME"
printf 'Install dir: %s\n' "$INSTALL_DIR"
if [ -d "$INSTALL_DIR/.git" ]; then
  git -C "$INSTALL_DIR" status --short --branch || true
  git -C "$INSTALL_DIR" rev-parse --short HEAD || true
else
  printf 'Agent checkout missing or not a git repository.\n'
fi

section "Config"
if [ -f "$CONFIG_PATH" ]; then
  printf 'Config exists: %s\n' "$CONFIG_PATH"
  ls -l "$CONFIG_PATH" || true
  sed -E 's/"apiKey"[[:space:]]*:[[:space:]]*"[^"]+"/"apiKey": "[redacted]"/' "$CONFIG_PATH" || true
else
  printf 'Config missing: %s\n' "$CONFIG_PATH"
fi

section "Service"
if [ -n "$UID_VALUE" ]; then
  runuser -u "$AGENT_USER" -- env XDG_RUNTIME_DIR="/run/user/$UID_VALUE" systemctl --user status magocode-agent.service --no-pager || true
else
  printf 'Cannot check service because user does not exist.\n'
fi

section "Recent Logs"
if [ -n "$UID_VALUE" ]; then
  runuser -u "$AGENT_USER" -- env XDG_RUNTIME_DIR="/run/user/$UID_VALUE" journalctl --user -u magocode-agent.service -n 100 --no-pager || true
else
  printf 'Cannot read logs because user does not exist.\n'
fi
