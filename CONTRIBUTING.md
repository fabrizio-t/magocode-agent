# Contributing

Thank you for contributing to MagoCode Agent.

## Development

```bash
npm install
npm test
npm start
```

For local testing, point the agent at a local config:

```bash
TASKIT_AGENT_CONFIG=./taskit-agent.local.json npm start
```

## Pull Requests

- Keep changes focused.
- Add or update tests for behavior changes.
- Do not commit local `.taskit*.json` config files or API keys.
- Do not broaden command or file-system access without documenting the security impact.

## Release Notes

User-visible changes should mention:

- supported API base
- wire protocol or capability changes
- minimum Node.js version
- migration or reinstall steps
