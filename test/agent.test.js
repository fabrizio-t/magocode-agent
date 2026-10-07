'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { WebSocketServer } = require('ws');

const pkg = require('../package.json');
const { createAgent, READ_FILE_MAX_BYTES } = require('../src/agent.js');
const { COMMAND_TYPES } = require('../src/protocol.js');

const TEST_SHELL = process.platform === 'win32' ? 'bash' : '/bin/bash';
const hasShell = spawnSync(TEST_SHELL, ['-c', 'exit 0']).status === 0;
const hasTail = spawnSync('tail', ['--version']).status === 0;
const API_KEY = 'agent-test:secret';
const WAIT_MS = 5000;

function startServer(options = {}) {
  return new Promise((resolve) => {
    const wss = new WebSocketServer({ port: 0, host: '127.0.0.1', ...options });
    const connections = [];
    const waiters = [];
    // Connections already handed out by nextConnection(), so one that arrives
    // before the test asks for it is not lost.
    let claimed = 0;
    wss.on('connection', (socket, req) => {
      const connection = { socket, req, messages: [], listeners: [] };
      socket.on('message', (data) => {
        const message = JSON.parse(data.toString('utf8'));
        connection.messages.push(message);
        for (const listener of [...connection.listeners]) listener(message);
      });
      connections.push(connection);
      const waiter = waiters.shift();
      if (waiter) {
        claimed += 1;
        waiter(connection);
      }
    });
    wss.on('listening', () => {
      resolve({
        wss,
        url: `ws://127.0.0.1:${wss.address().port}`,
        connections,
        nextConnection() {
          if (connections.length > claimed) return Promise.resolve(connections[claimed++]);
          return withTimeout(new Promise((res) => waiters.push(res)), 'agent connection');
        },
      });
    });
  });
}

function withTimeout(promise, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out waiting for ${label}`)), WAIT_MS);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function waitForMessage(connection, predicate, label = 'message') {
  const existing = connection.messages.find(predicate);
  if (existing) return Promise.resolve(existing);
  return withTimeout(new Promise((resolve) => {
    const listener = (message) => {
      if (!predicate(message)) return;
      connection.listeners.splice(connection.listeners.indexOf(listener), 1);
      resolve(message);
    };
    connection.listeners.push(listener);
  }), label);
}

function request(connection, message) {
  connection.socket.send(JSON.stringify(message));
  return waitForMessage(
    connection,
    (reply) => reply.id === message.id && reply.type !== 'pty.data' && reply.type !== 'tail.line',
    `reply to ${message.type}`,
  );
}

/**
 * Run `fn` against a loopback server with one connected agent, then tear
 * everything down. The agent home is a fresh temp directory.
 */
async function withAgent({ env = {}, serverOptions = {} } = {}, fn) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'magocode-agent-test-'));
  const server = await startServer(serverOptions);
  const configPath = path.join(home, 'config.json');
  fs.writeFileSync(configPath, JSON.stringify({ instance: server.url, apiKey: API_KEY }));
  const logs = [];
  const logger = {
    log: (...args) => logs.push(args.join(' ')),
    error: (...args) => logs.push(args.join(' ')),
  };
  const agent = createAgent({
    configPath,
    logger,
    env: {
      MAGOCODE_AGENT_HOME: home,
      MAGOCODE_AGENT_TMP_PREFIX: path.join(home, 'tmp-'),
      MAGOCODE_AGENT_SHELL: TEST_SHELL,
      MAGOCODE_AGENT_RECONNECT_MS: '20',
      MAGOCODE_AGENT_RECONNECT_MAX_MS: '40',
      ...env,
    },
  });
  const firstConnection = server.nextConnection();
  agent.start();
  try {
    const connection = await firstConnection;
    await waitForMessage(connection, (message) => message.type === 'hello', 'hello');
    await fn({ agent, server, connection, home, logs });
  } finally {
    agent.stop();
    for (const client of server.wss.clients) client.terminate();
    await new Promise((resolve) => server.wss.close(resolve));
    fs.rmSync(home, { recursive: true, force: true });
  }
}

describe('agent over a loopback connection', () => {
  it('has a handler for every command type in the protocol', () => {
    const agent = createAgent({ logger: { log() {}, error() {} } });
    assert.deepEqual([...agent.commandTypes].sort(), [...COMMAND_TYPES].sort());
  });

  it('authenticates and announces itself with the package version', async () => {
    await withAgent({}, async ({ connection, agent }) => {
      assert.equal(connection.req.headers['x-api-key'], API_KEY);
      assert.equal(connection.req.url, '/agent');
      const hello = connection.messages.find((message) => message.type === 'hello');
      assert.equal(hello.agentVersion, pkg.version);
      assert.equal(hello.protocolVersion, 1);
      assert.equal(hello.os, process.platform);
      assert.deepEqual(hello.capabilities, agent.capabilities());
      for (const capability of ['tail', 'exec', 'writeFile', 'readFile', 'fileExists']) {
        assert.ok(hello.capabilities.includes(capability), `missing capability ${capability}`);
      }
    });
  });

  it('answers application pings', async () => {
    await withAgent({}, async ({ connection }) => {
      connection.socket.send(JSON.stringify({ type: 'ping' }));
      await waitForMessage(connection, (message) => message.type === 'pong', 'pong');
    });
  });

  it('replies EUNSUPPORTED to unknown message types instead of staying silent', async () => {
    await withAgent({}, async ({ connection }) => {
      const reply = await request(connection, { id: 'u1', type: 'exec.stream' });
      assert.equal(reply.type, 'error');
      assert.equal(reply.code, 'EUNSUPPORTED');
    });
  });

  it('reports malformed messages and keeps the connection', async () => {
    await withAgent({}, async ({ connection }) => {
      connection.socket.send('{not json');
      const reply = await waitForMessage(connection, (message) => message.type === 'error', 'protocol error');
      assert.equal(reply.code, 'AGENT_PROTOCOL_INVALID_JSON');
      connection.socket.send(JSON.stringify({ type: 'ping' }));
      await waitForMessage(connection, (message) => message.type === 'pong', 'pong after bad message');
    });
  });

  it('runs commands and returns their exit code', { skip: !hasShell }, async () => {
    await withAgent({}, async ({ connection, logs }) => {
      const ok = await request(connection, { id: 'e1', type: 'exec', cmd: 'echo hello' });
      assert.equal(ok.type, 'exec.result');
      assert.equal(ok.code, 0);
      assert.equal(ok.stdout.trim(), 'hello');

      const failed = await request(connection, { id: 'e2', type: 'exec', cmd: 'echo nope >&2; exit 3' });
      assert.equal(failed.code, 3);
      assert.equal(failed.stderr.trim(), 'nope');

      const auditLine = logs.map((line) => { try { return JSON.parse(line); } catch { return null; } })
        .find((entry) => entry && entry.op === 'exec' && entry.id === 'e2');
      assert.ok(auditLine, 'exec was not written to the audit log');
      assert.equal(auditLine.code, 3);
      assert.equal(auditLine.cmd, 'echo nope >&2; exit 3');
    });
  });

  it('does not report success when the working directory is missing', async () => {
    const missing = path.join(os.tmpdir(), 'magocode-agent-missing-cwd', String(Date.now()));
    await withAgent({ env: { MAGOCODE_AGENT_CWD: missing } }, async ({ connection }) => {
      const reply = await request(connection, { id: 'e3', type: 'exec', cmd: 'echo hello' });
      assert.equal(reply.type, 'exec.result');
      assert.notEqual(reply.code, 0);
      assert.equal(reply.errorCode, 'ENOENT');
      assert.equal(reply.stdout, '');
    });
  });

  it('does not report success when output is truncated', { skip: !hasShell }, async () => {
    await withAgent({}, async ({ connection }) => {
      const reply = await request(connection, {
        id: 'e4',
        type: 'exec',
        cmd: "head -c 3000000 /dev/zero | tr '\\0' a",
      });
      assert.equal(reply.type, 'exec.result');
      assert.notEqual(reply.code, 0);
      assert.equal(reply.truncated, true);
      assert.equal(reply.errorCode, 'EOUTPUTTOOLARGE');
    });
  });

  it('times out long commands', { skip: !hasShell }, async () => {
    await withAgent({}, async ({ connection }) => {
      const reply = await request(connection, { id: 'e5', type: 'exec', cmd: 'sleep 30', timeoutMs: 1000 });
      assert.equal(reply.type, 'error');
      assert.equal(reply.code, 'ETIMEDOUT');
    });
  });

  it('rejects an invalid file mode without crashing', async () => {
    await withAgent({}, async ({ connection, home }) => {
      const target = path.join(home, 'mode.txt');
      for (const [index, mode] of ['rw-r--r--', '9', { a: 1 }].entries()) {
        const reply = await request(connection, {
          id: `m${index}`,
          type: 'writeFile',
          path: target,
          b64Contents: Buffer.from('data').toString('base64'),
          mode,
        });
        assert.equal(reply.type, 'error');
        assert.equal(reply.code, 'EINVAL');
      }
      assert.equal(fs.existsSync(target), false, 'file must not be written when the mode is invalid');
      connection.socket.send(JSON.stringify({ type: 'ping' }));
      await waitForMessage(connection, (message) => message.type === 'pong', 'pong after invalid mode');
    });
  });

  it('writes, reads and checks files inside the agent home', async () => {
    await withAgent({}, async ({ connection, home }) => {
      const target = path.join(home, 'notes.txt');
      const written = await request(connection, {
        id: 'f1',
        type: 'writeFile',
        path: target,
        b64Contents: Buffer.from('hello agent').toString('base64'),
        mode: '600',
      });
      assert.equal(written.type, 'writeFile.result');
      assert.equal(fs.readFileSync(target, 'utf8'), 'hello agent');

      const read = await request(connection, { id: 'f2', type: 'readFile', path: target });
      assert.equal(Buffer.from(read.b64Contents, 'base64').toString('utf8'), 'hello agent');

      const exists = await request(connection, { id: 'f3', type: 'fileExists', path: target });
      assert.equal(exists.exists, true);
      const missing = await request(connection, { id: 'f4', type: 'fileExists', path: path.join(home, 'nope') });
      assert.equal(missing.exists, false);
    });
  });

  it('refuses paths that escape the agent home', async () => {
    await withAgent({}, async ({ connection, home }) => {
      const outside = path.join(os.tmpdir(), `magocode-agent-outside-${Date.now()}.txt`);
      const escaping = `${home}${path.sep}sub${path.sep}..${path.sep}..${path.sep}${path.basename(outside)}`;
      for (const [index, target] of [outside, escaping].entries()) {
        const reply = await request(connection, {
          id: `p${index}`,
          type: 'writeFile',
          path: target,
          b64Contents: Buffer.from('x').toString('base64'),
        });
        assert.equal(reply.type, 'error');
        assert.equal(reply.code, 'EACCES');
      }
      assert.equal(fs.existsSync(outside), false);
      const tail = await request(connection, { id: 'p9', type: 'tail.start', path: outside });
      assert.equal(tail.code, 'EACCES');
    });
  });

  it('streams appended lines from a tailed file', { skip: !hasTail }, async () => {
    await withAgent({}, async ({ connection, home }) => {
      const logFile = path.join(home, 'task.jsonl');
      fs.writeFileSync(logFile, 'first\n');
      connection.socket.send(JSON.stringify({ id: 't1', type: 'tail.start', path: logFile }));
      await waitForMessage(connection, (message) => message.type === 'tail.line' && message.line === 'first', 'first line');
      fs.appendFileSync(logFile, 'second\n');
      await waitForMessage(connection, (message) => message.type === 'tail.line' && message.line === 'second', 'appended line');
      connection.socket.send(JSON.stringify({ id: 't1', type: 'tail.stop' }));
      const end = await waitForMessage(connection, (message) => message.type === 'tail.end', 'tail end');
      assert.equal(end.reason, 'stopped');
    });
  });

  it('refuses to read files over the size limit', async () => {
    await withAgent({}, async ({ connection, home }) => {
      const big = path.join(home, 'big.bin');
      fs.writeFileSync(big, Buffer.alloc(READ_FILE_MAX_BYTES + 1));
      const reply = await request(connection, { id: 'b1', type: 'readFile', path: big });
      assert.equal(reply.type, 'error');
      assert.equal(reply.code, 'EFBIG');
    });
  });

  it('reconnects after the server drops the connection', async () => {
    await withAgent({}, async ({ connection, server }) => {
      const reconnected = server.nextConnection();
      connection.socket.close();
      const second = await reconnected;
      await waitForMessage(second, (message) => message.type === 'hello', 'hello after reconnect');
    });
  });

  it('detects a silent connection and reconnects', async () => {
    // autoPong:false makes the server ignore protocol pings, which is what a
    // half-open connection looks like from the agent side.
    await withAgent({
      env: { MAGOCODE_AGENT_HEARTBEAT_MS: '50' },
      serverOptions: { autoPong: false },
    }, async ({ server, logs }) => {
      const second = await server.nextConnection();
      await waitForMessage(second, (message) => message.type === 'hello', 'hello after heartbeat timeout');
      assert.ok(logs.some((line) => line.includes('heartbeat timed out')), 'heartbeat timeout was not logged');
    });
  });

  it('keeps a healthy connection open across heartbeats', async () => {
    await withAgent({ env: { MAGOCODE_AGENT_HEARTBEAT_MS: '30' } }, async ({ connection, server }) => {
      await new Promise((resolve) => setTimeout(resolve, 250));
      assert.equal(server.connections.length, 1);
      connection.socket.send(JSON.stringify({ type: 'ping' }));
      await waitForMessage(connection, (message) => message.type === 'pong', 'pong on a healthy connection');
    });
  });
});
