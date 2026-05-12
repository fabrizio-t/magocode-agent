# MagoCode Agent

Outbound agent for MagoCode-managed machines.

This package is being extracted from the main MagoCode app so it can become a small, auditable, open-source component. It is not yet published as a separate repository.

## What It Does

The agent runs on a user's machine or VPS and opens an outbound WebSocket connection to MagoCode. Through that connection MagoCode can:

- run shell commands
- open interactive PTY sessions
- tail log files
- read/write files in approved task paths
- report basic runtime metadata and capabilities

The agent does not require inbound SSH or open firewall ports.

## Security Model

This agent can execute commands on the machine where it runs. Only install it on machines you intend MagoCode to control.

Current capabilities:

- `tail`
- `exec`
- `writeFile`
- `readFile`
- `fileExists`
- `pty`

Path-scoped file access is limited to:

- `/home/taskit/**`
- `/tmp/taskit-*`

## Configuration

By default the agent reads:

```text
/home/taskit/.taskit.json
```

Override with:

```bash
TASKIT_AGENT_CONFIG=/path/to/config.json npm start
```

Example config:

```json
{
  "instance": "https://taskit.fly.dev",
  "apiKey": "agent-vps-example:secret"
}
```

`instance` may be `https://`, `http://`, `wss://`, or `ws://`. The agent connects to `/agent`.

## Install

The first standalone install flow uses a git checkout on the VPS and a systemd user service:

```bash
curl -fsSL https://raw.githubusercontent.com/magocode/magocode-agent/main/install.sh | sudo bash -s -- --api-key 'agent-sub:secret'
```

See [docs/install.md](docs/install.md).

## Development

```bash
npm install
npm test
npm start
```

For local testing:

```bash
TASKIT_AGENT_CONFIG=./taskit-agent.local.json npm start
```

## Current Status

This folder is an in-repo staging area. Next steps:

- wire Hetzner provisioning to install this package instead of rendering an embedded script
- add enrollment-token based setup for self-hosted/BYO nodes
- choose the public license before splitting to a separate repo
- split to a dedicated public repository once the package boundary is stable
