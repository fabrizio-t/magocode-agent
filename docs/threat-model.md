# Threat Model

MagoCode Agent runs on a user-owned machine or VPS and accepts commands from MagoCode over an outbound WebSocket connection.

## Assets

- The host running the agent.
- The MagoCode agent API key stored in `/home/taskit/.taskit.json`.
- Repositories, task logs, and files under approved task paths.
- User credentials already present on the host, such as Git credentials or CLI auth sessions.

## Trust Boundaries

- The agent process trusts commands received from the authenticated MagoCode server.
- The MagoCode server must treat agent API keys as machine credentials, not human sessions.
- The host operating system enforces the `taskit` user boundary.
- The network only needs outbound connectivity from the agent to MagoCode.

## Intended Capabilities

- Execute shell commands.
- Open interactive PTY sessions.
- Tail task log files.
- Read/write task-scoped files.
- Report runtime metadata and capabilities.

## Non-Goals

- Sandboxing arbitrary commands.
- Protecting the host from a malicious MagoCode account owner.
- Running untrusted third-party workloads safely.
- Replacing OS-level least privilege, firewalling, or secrets hygiene.

## Key Risks

- Agent API key exposure allows an attacker to connect as that machine.
- A compromised MagoCode account can command the agent for machines it controls.
- Over-broad file access can expose host secrets.
- Installing from an unpinned branch can change behavior without review.

## Mitigations

- Install by release tag, not by mutable `main`.
- Store `/home/taskit/.taskit.json` with `600` permissions.
- Run as the non-root `taskit` user.
- Keep file access scoped to approved task paths.
- Revoke/delete compromised agents and reinstall with a new key.
- Keep server-side agent API keys restricted to agent-only endpoints.
