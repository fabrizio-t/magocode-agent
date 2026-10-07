#!/usr/bin/env node
'use strict';

const { createAgent } = require('./agent.js');

const agent = createAgent();

function shutdown() {
  agent.stop();
  process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

// A bug in one handler must not leave a half-working agent behind. Log,
// exit non-zero, and let systemd (`Restart=always`) bring up a clean process.
process.on('uncaughtException', (err) => {
  console.error('magocode-agent uncaught exception:', err && err.stack ? err.stack : err);
  process.exit(1);
});
process.on('unhandledRejection', (reason) => {
  console.error('magocode-agent unhandled rejection:', reason && reason.stack ? reason.stack : reason);
  process.exit(1);
});

agent.start();
