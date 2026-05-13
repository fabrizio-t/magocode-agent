# Agent Wire Protocol

Transport: WebSocket.

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
  "agentVersion": "0.1.0",
  "os": "linux",
  "arch": "x64",
  "capabilities": ["tail", "exec", "writeFile", "readFile", "fileExists", "pty"]
}
```

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

## Error Shape

```json
{
  "id": "request-id",
  "type": "error",
  "code": "EACCES",
  "message": "path must be under /home/magocode or /tmp/magocode-*"
}
```

## PTY Data

PTY payloads are base64 encoded UTF-8:

```json
{
  "id": "pty-id",
  "type": "pty.data",
  "b64": "..."
}
```
