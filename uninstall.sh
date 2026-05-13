#!/usr/bin/env bash
set -euo pipefail

AGENT_USER="${MAGOCODE_AGENT_USER:-magocode}"
PURGE_CONFIG="false"
REMOVE_FILES="false"

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
  sudo bash uninstall.sh [--purge-config] [--remove-files]

Options:
  --purge-config  Remove /home/magocode/.magocode.json.
  --remove-files  Remove /home/magocode/magocode-agent.

The magocode user is not deleted.
USAGE
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --purge-config)
      PURGE_CONFIG="true"
      shift
      ;;
    --remove-files)
      REMOVE_FILES="true"
      shift
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

[ "$(id -u)" -eq 0 ] || fail "run as root, for example: sudo bash uninstall.sh"

if ! id "$AGENT_USER" >/dev/null 2>&1; then
  log "user '$AGENT_USER' does not exist; nothing to stop"
  exit 0
fi

AGENT_HOME="$(getent passwd "$AGENT_USER" | cut -d: -f6)"
[ -n "$AGENT_HOME" ] || fail "could not resolve home directory for '$AGENT_USER'"

INSTALL_DIR="$AGENT_HOME/magocode-agent"
CONFIG_PATH="$AGENT_HOME/.magocode.json"
SERVICE_PATH="$AGENT_HOME/.config/systemd/user/magocode-agent.service"
UID_VALUE="$(id -u "$AGENT_USER")"

systemctl_user() {
  runuser -u "$AGENT_USER" -- env XDG_RUNTIME_DIR="/run/user/$UID_VALUE" systemctl --user "$@"
}

log "stopping service"
systemctl_user stop magocode-agent.service >/dev/null 2>&1 || true
systemctl_user disable magocode-agent.service >/dev/null 2>&1 || true

if [ -f "$SERVICE_PATH" ]; then
  log "removing service file"
  rm -f "$SERVICE_PATH"
fi

systemctl_user daemon-reload >/dev/null 2>&1 || true

if [ "$REMOVE_FILES" = "true" ] && [ -d "$INSTALL_DIR" ]; then
  log "removing $INSTALL_DIR"
  rm -rf "$INSTALL_DIR"
fi

if [ "$PURGE_CONFIG" = "true" ] && [ -f "$CONFIG_PATH" ]; then
  log "removing $CONFIG_PATH"
  rm -f "$CONFIG_PATH"
fi

cat <<DONE

MagoCode agent service removed.

Kept:
  user: $AGENT_USER
  config: $CONFIG_PATH
  files: $INSTALL_DIR

Use --purge-config and/or --remove-files to remove those paths.
DONE
