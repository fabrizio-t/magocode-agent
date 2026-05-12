#!/usr/bin/env bash
set -euo pipefail

DEFAULT_API_URL="https://api.magocode.com"
DEFAULT_AGENT_REPO="https://github.com/magocode/magocode-agent.git"
DEFAULT_AGENT_REF="main"
DEFAULT_AGENT_USER="taskit"

API_URL="${MAGOCODE_API_URL:-$DEFAULT_API_URL}"
AGENT_REPO="${MAGOCODE_AGENT_REPO:-$DEFAULT_AGENT_REPO}"
AGENT_REF="${MAGOCODE_AGENT_REF:-$DEFAULT_AGENT_REF}"
AGENT_USER="${MAGOCODE_AGENT_USER:-$DEFAULT_AGENT_USER}"
API_KEY=""

log() {
  printf '[magocode-agent] %s\n' "$*"
}

fail() {
  printf '[magocode-agent] ERROR: %s\n' "$*" >&2
  exit 1
}

usage() {
  cat <<'USAGE'
Usage:
  sudo bash install.sh --api-key 'agent-sub:secret'

Internal/dev overrides:
  MAGOCODE_API_URL=https://api.magocode.com
  MAGOCODE_AGENT_REPO=https://github.com/magocode/magocode-agent.git
  MAGOCODE_AGENT_REF=main
  MAGOCODE_AGENT_USER=taskit
USAGE
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --api-key)
      [ "$#" -ge 2 ] || fail "--api-key requires a value"
      API_KEY="$2"
      shift 2
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      fail "unknown argument: $1"
      ;;
  esac
done

[ "$(id -u)" -eq 0 ] || fail "run as root, for example: sudo bash install.sh --api-key 'agent-sub:secret'"
[ -n "$API_KEY" ] || fail "--api-key is required"
case "$API_KEY" in
  *:*) ;;
  *) fail "--api-key must look like 'agent-sub:secret'" ;;
esac

if [ ! -r /etc/os-release ]; then
  fail "cannot detect Linux distribution: /etc/os-release is missing"
fi

# shellcheck disable=SC1091
. /etc/os-release
case "${ID:-}" in
  ubuntu|debian)
    PACKAGE_MANAGER="apt"
    ;;
  *)
    case "${ID_LIKE:-}" in
      *debian*|*ubuntu*) PACKAGE_MANAGER="apt" ;;
      *) fail "unsupported distribution '${ID:-unknown}'. Initial installer supports Ubuntu/Debian." ;;
    esac
    ;;
esac

ensure_apt_dependencies() {
  export DEBIAN_FRONTEND=noninteractive
  apt-get update
  apt-get install -y ca-certificates curl git build-essential python3 make g++ nodejs npm
}

node_major() {
  if ! command -v node >/dev/null 2>&1; then
    printf '0\n'
    return
  fi
  node -p "Number(process.versions.node.split('.')[0])" 2>/dev/null || printf '0\n'
}

ensure_node_runtime() {
  local major
  major="$(node_major)"
  if [ "$major" -ge 20 ]; then
    return
  fi

  log "installing Node.js 20 runtime"
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs

  major="$(node_major)"
  [ "$major" -ge 20 ] || fail "Node.js 20+ is required"
}

user_home() {
  getent passwd "$AGENT_USER" | cut -d: -f6
}

run_as_agent() {
  runuser -u "$AGENT_USER" -- "$@"
}

install_user_service() {
  local service_dir="$1"
  local service_path="$service_dir/magocode-agent.service"
  mkdir -p "$service_dir"
  cat > "$service_path" <<SERVICE
[Unit]
Description=MagoCode outbound agent
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=$INSTALL_DIR
ExecStart=$(command -v node) $INSTALL_DIR/src/index.js
Restart=always
RestartSec=5
Environment=NODE_ENV=production
Environment=TASKIT_AGENT_CONFIG=$CONFIG_PATH

[Install]
WantedBy=default.target
SERVICE
  chown "$AGENT_USER:$AGENT_USER" "$service_path"
  chmod 644 "$service_path"
}

systemctl_user() {
  local uid
  uid="$(id -u "$AGENT_USER")"
  systemctl start "user@$uid.service" >/dev/null 2>&1 || true
  run_as_agent env XDG_RUNTIME_DIR="/run/user/$uid" systemctl --user "$@"
}

if [ "$PACKAGE_MANAGER" = "apt" ]; then
  log "installing OS dependencies"
  ensure_apt_dependencies
  ensure_node_runtime
fi

if id "$AGENT_USER" >/dev/null 2>&1; then
  log "using existing user '$AGENT_USER'"
else
  log "creating user '$AGENT_USER'"
  useradd --create-home --shell /bin/bash "$AGENT_USER"
fi

AGENT_HOME="$(user_home)"
[ -n "$AGENT_HOME" ] || fail "could not resolve home directory for '$AGENT_USER'"

INSTALL_DIR="$AGENT_HOME/magocode-agent"
CONFIG_PATH="$AGENT_HOME/.taskit.json"
LOG_DIR="$AGENT_HOME/taskit-logs"
SERVICE_DIR="$AGENT_HOME/.config/systemd/user"

mkdir -p "$LOG_DIR" "$SERVICE_DIR"
chown -R "$AGENT_USER:$AGENT_USER" "$LOG_DIR" "$SERVICE_DIR"

if [ -d "$INSTALL_DIR/.git" ]; then
  log "updating existing agent checkout"
  git -C "$INSTALL_DIR" remote set-url origin "$AGENT_REPO"
  git -C "$INSTALL_DIR" fetch --tags origin
else
  if [ -d "$INSTALL_DIR" ] && [ -n "$(find "$INSTALL_DIR" -mindepth 1 -maxdepth 1 -print -quit 2>/dev/null)" ]; then
    fail "$INSTALL_DIR exists and is not a git checkout"
  fi
  rm -rf "$INSTALL_DIR"
  log "cloning agent repository"
  git clone "$AGENT_REPO" "$INSTALL_DIR"
fi

git -C "$INSTALL_DIR" checkout "$AGENT_REF"
if git -C "$INSTALL_DIR" rev-parse --verify "origin/$AGENT_REF" >/dev/null 2>&1; then
  git -C "$INSTALL_DIR" pull --ff-only origin "$AGENT_REF"
fi
chown -R "$AGENT_USER:$AGENT_USER" "$INSTALL_DIR"

log "writing agent config"
cat > "$CONFIG_PATH" <<CONFIG
{
  "instance": "$API_URL",
  "apiKey": "$API_KEY"
}
CONFIG
chown "$AGENT_USER:$AGENT_USER" "$CONFIG_PATH"
chmod 600 "$CONFIG_PATH"

log "installing npm dependencies"
run_as_agent bash -lc "cd '$INSTALL_DIR' && npm install --omit=dev --no-audit --no-fund"

log "installing systemd user service"
install_user_service "$SERVICE_DIR"

log "enabling user service"
loginctl enable-linger "$AGENT_USER"
systemctl_user daemon-reload
systemctl_user enable magocode-agent.service
systemctl_user restart magocode-agent.service

cat <<DONE

MagoCode agent installed.

Status:
  systemctl --machine $AGENT_USER@ --user status magocode-agent

Logs:
  journalctl --machine $AGENT_USER@ --user -u magocode-agent -n 100 --no-pager

Diagnostics:
  sudo bash $INSTALL_DIR/scripts/print-diagnostics.sh
DONE
