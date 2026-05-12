# Security Policy

## Supported Versions

Security fixes are provided for the latest tagged release.

## Reporting a Vulnerability

Do not open a public issue for suspected vulnerabilities.

Report security issues by email:

```text
security@magocode.com
```

Include:

- affected version or commit
- operating system and install method
- impact summary
- reproduction steps, if safe to share

We will acknowledge reports as soon as practical and coordinate fixes before public disclosure.

## Threat Model

The MagoCode agent is intentionally powerful. It can execute commands on the machine where it is installed.

Expected security boundaries:

- The agent authenticates to MagoCode with a machine-scoped API key.
- The agent opens outbound connections only.
- The agent does not require inbound firewall ports.
- Server-side authorization must treat agent API keys as machine credentials, not human user sessions.
- File operations are scoped by the agent implementation to approved task paths.

If an agent API key is exposed, revoke or delete that agent in MagoCode and reinstall with a new key.
