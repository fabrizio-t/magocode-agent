# Install MagoCode Agent

The agent is installed from a git checkout and runs as a systemd user service under the `taskit` Linux user.

## Install

Create an agent API key in MagoCode, then run:

```bash
curl -fsSL https://raw.githubusercontent.com/magocode/magocode-agent/main/install.sh | sudo bash -s -- --api-key 'agent-sub:secret'
```

The installer defaults to:

```text
https://api.magocode.com
```

The API key is stored at:

```text
/home/taskit/.taskit.json
```

with `600` permissions.

## Private Testing

Until the standalone public repository exists, run a local copy of `install.sh` and override the repository/ref:

```bash
MAGOCODE_AGENT_REPO=https://github.com/<owner>/<repo>.git \
MAGOCODE_AGENT_REF=<branch-or-tag> \
MAGOCODE_API_URL=https://api.magocode.com \
  sudo -E bash install.sh --api-key 'agent-sub:secret'
```

Do not create a nested git repository inside the main MagoCode monorepo. Create the public `magocode-agent` repository separately when the package boundary is ready.

## Status

```bash
systemctl --machine taskit@ --user status magocode-agent
```

## Logs

```bash
journalctl --machine taskit@ --user -u magocode-agent -n 100 --no-pager
```

## Diagnostics

```bash
sudo bash /home/taskit/magocode-agent/scripts/print-diagnostics.sh
```

Diagnostics redact the API key before printing config.

## Update

Re-run the installer with the same API key and desired ref:

```bash
MAGOCODE_AGENT_REF=v0.1.0 sudo -E bash install.sh --api-key 'agent-sub:secret'
```

The installer fetches the repository, checks out the ref, runs `npm install --omit=dev`, and restarts the service.

## Uninstall

Stop and remove the service:

```bash
sudo bash /home/taskit/magocode-agent/uninstall.sh
```

Also remove config and files:

```bash
sudo bash /home/taskit/magocode-agent/uninstall.sh --purge-config --remove-files
```

The `taskit` user is not deleted by default.

## Security Notes

The API key lets this machine connect to MagoCode as the configured agent. Store it like a password.

The installed service can execute commands on the machine where it runs. Only install it on machines you intend MagoCode to control.
