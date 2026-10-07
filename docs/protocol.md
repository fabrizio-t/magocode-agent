# Agent Wire Protocol

Transport: WebSocket, one JSON object per text frame.

Authentication: `X-API-Key` header containing `agentSub:secret`.

The agent connects to:

```text
{instance}/agent
```

where `https://` maps to `wss://` and `http://` maps to `ws://`.

## Hello

Sent by the agent after the socket opens:

```json
{
  "type": "hello",
  "agentVersion": "0.3.0",
  "protocolVersion": 1,
  "os": "linux",
  "arch": "x64",
  "capabilities": ["tail", "exec", "writeFile", "readFile", "fileExists", "pty"]
}
```

- `agentVersion` is the `version` field of `package.json`, which matches the release tag.
- `protocolVersion` is an integer. It changes only when a release is not backwards compatible on the wire. Additive fields and new message types do not change it.
- `capabilities` is computed at startup. `pty` is omitted when the native `node-pty` module is unavailable; the other capabilities keep working.

## Commands

Server-to-agent:

- `ping`
- `tail.start`
- `tail.stop`
- `exec`
- `writeFile`
- `readFile`
- `fileExists`
- `pty.open`
- `pty.write`
- `pty.resize`
- `pty.kill`

Agent-to-server:

- `pong`
- `tail.line`
- `tail.end`
- `exec.result`
- `writeFile.result`
- `readFile.result`
- `fileExists.result`
- `pty.data`
- `pty.exit`
- `error`

A message type the agent does not handle is answered with an `error` whose code is `EUNSUPPORTED`, carrying the request `id` when one was sent. A message that cannot be parsed is answered with an `error` without an `id`.

## Exec Result

```json
{
  "id": "request-id",
  "type": "exec.result",
  "stdout": "...",
  "stderr": "...",
  "code": 0
}
```

`code` is `0` only when the command ran and exited successfully. Every failure has a non-zero `code`:

| Situation | `code` | Extra fields |
| --- | --- | --- |
| Command exited non-zero | the exit code | |
| Output exceeded the 1 MB buffer | `1` | `truncated: true`, `errorCode: "EOUTPUTTOOLARGE"` |
| Command could not be started (for example a missing working directory) | `1` | `errorCode` with the system error, such as `"ENOENT"` |
| Command was killed by a signal | `128 + signal number` | `signal`, such as `"SIGKILL"` |

Two outcomes are reported as `error` messages instead of `exec.result`:

- `ETIMEDOUT`: the command ran longer than `timeoutMs` (clamped to 1 second – 10 minutes, default 30 seconds).
- `EABORTED`: the connection closed while the command was running. This reply is normally never delivered; it exists for the audit log.

## Error Shape

```json
{
  "id": "request-id",
  "type": "error",
  "code": "EACCES",
  "message": "path must be under /home/magocode or /tmp/magocode-*"
}
```

Codes produced by the agent itself:

| Code | Meaning |
| --- | --- |
| `EINVAL` | A required field is missing or invalid, including a `writeFile` `mode` that is not an octal file mode |
| `EACCES` | The path is outside the agent home and the agent tmp prefix |
| `EFBIG` | `readFile` target is larger than 700 KB |
| `EBUSY` | Too many concurrent commands (32), tails (32) or PTYs (16) |
| `EUNSUPPORTED` | Unknown message type |
| `ETIMEDOUT` | `exec` exceeded its timeout |
| `PTY_UNAVAILABLE` | `pty.open` on an agent without the `pty` capability |
| `AGENT_MESSAGE_TOO_LARGE` | Inbound message larger than 1 MB |
| `AGENT_PROTOCOL_*` | Inbound message was not a valid protocol message |
| `EINTERNAL` | A handler failed unexpectedly |

System error codes from the operating system (`ENOENT`, `EISDIR`, and so on) are passed through for file operations.

## Paths

`writeFile`, `readFile`, `fileExists` and `tail.start` accept absolute paths under the agent home (default `/home/magocode`) or starting with the agent tmp prefix (default `/tmp/magocode-`). Paths are normalized before the check, so `..` segments cannot leave those roots, and the operation runs on the normalized path.

This is a guardrail against mistakes, not a security boundary: symlinks are not resolved, and `exec` already runs arbitrary commands as the agent user.

## PTY Data

PTY payloads are base64 encoded UTF-8:

```json
{
  "id": "pty-id",
  "type": "pty.data",
  "b64": "..."
}
```

## Liveness And Reconnect

- The server sends `ping` messages; the agent answers each with `pong`.
- The agent also sends a WebSocket protocol ping every 30 seconds. If no pong and no other inbound traffic arrives before the next one, it terminates the socket and reconnects. This detects half-open connections that would otherwise look healthy.
- Reconnect uses exponential backoff from 5 seconds to 60 seconds with ±20% jitter. The delay resets after a successful connection.
- The config file is re-read on every connection attempt, so a rotated API key is picked up without a restart.

## Delivery Semantics

Delivery is **at-most-once** in both directions. Nothing is queued across connections.

- A message the agent produces while the socket is not open is dropped.
- When the connection closes, the agent stops all tails, kills all PTYs and terminates commands that are still running. Their state is connection-scoped.
- A server that loses the connection while waiting for an `exec.result` cannot tell from the protocol whether the command completed. Commands that are not idempotent should be made safe to repeat, or verified before retrying.

## Limits

| Limit | Value |
| --- | --- |
| Inbound message | 1 MB |
| `exec` combined output buffer | 1 MB |
| `exec` timeout | 1 second – 10 minutes |
| `readFile` file size | 700 KB |
| Concurrent commands / tails / PTYs | 32 / 32 / 16 |

## Audit Log

The agent writes one JSON line to stdout for each `exec`, `writeFile`, `readFile`, `tail.start` and `pty.open`, with a timestamp, the request id, the command or path, and for `exec` the exit code and duration. Under systemd these lines are kept by journald:

```bash
journalctl --machine magocode@ --user -u magocode-agent -o cat | grep '"event":"agent.op"'
```

Commands are truncated to 300 characters in the log.
