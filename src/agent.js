'use strict';

const fs = require('fs');
const readline = require('readline');
const { exec: childExec, spawn } = require('child_process');
const WebSocket = require('ws');

const { nextReconnectDelay } = require('./backoff.js');
const { readConfig } = require('./config.js');
const { mapExecOutcome } = require('./exec.js');
const { MAX_MESSAGE_BYTES, isCommandType, parseMessage, serializeMessage } = require('./protocol.js');
const {
  DEFAULT_HOME,
  DEFAULT_TMP_PREFIX,
  parseFileMode,
  resolveAllowedPath,
  unwrapMagoCodeSuCommand,
} = require('./shell.js');
const { CAPABILITIES, PROTOCOL_VERSION, VERSION } = require('./version.js');

const EXEC_MAX_BUFFER = 1024 * 1024;
// A file is sent base64-encoded inside one JSON message, so the raw size has
// to leave room for the 4/3 expansion under MAX_MESSAGE_BYTES.
const READ_FILE_MAX_BYTES = 700 * 1024;
// Hard bound enforced by the socket itself; anything between this and
// MAX_MESSAGE_BYTES is rejected by parseMessage with a reply.
const SOCKET_MAX_PAYLOAD = MAX_MESSAGE_BYTES * 4;
const MAX_CONCURRENT_EXECS = 32;
const MAX_TAILS = 32;
const MAX_PTYS = 16;
const AUDIT_CMD_MAX_CHARS = 300;

function positiveNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function readSettings(env = process.env) {
  const home = env.MAGOCODE_AGENT_HOME || DEFAULT_HOME;
  return {
    home,
    cwd: env.MAGOCODE_AGENT_CWD || home,
    tmpPrefix: env.MAGOCODE_AGENT_TMP_PREFIX || DEFAULT_TMP_PREFIX,
    shell: env.MAGOCODE_AGENT_SHELL || '/bin/bash',
    user: env.MAGOCODE_AGENT_USER || 'magocode',
    reconnectMs: positiveNumber(env.MAGOCODE_AGENT_RECONNECT_MS, 5000),
    reconnectMaxMs: positiveNumber(env.MAGOCODE_AGENT_RECONNECT_MAX_MS, 60000),
    heartbeatMs: positiveNumber(env.MAGOCODE_AGENT_HEARTBEAT_MS, 30000),
  };
}

/**
 * Build an agent instance. All state lives in the closure so tests can run
 * several agents against a loopback server; `src/index.js` creates the one
 * used in production.
 */
function createAgent({ configPath, env = process.env, logger = console } = {}) {
  const settings = readSettings(env);
  const pathOptions = { home: settings.home, tmpPrefix: settings.tmpPrefix };

  let ws = null;
  let reconnectTimer = null;
  let heartbeatTimer = null;
  let awaitingPong = false;
  let failedAttempts = 0;
  let stopped = false;
  let ptyModule;
  const tails = new Map();
  const ptys = new Map();
  const execs = new Set();
  const abortedExecs = new WeakSet();

  // node-pty is a native module. If it failed to build, keep serving the
  // other capabilities instead of crashing at startup.
  function loadPty() {
    if (ptyModule !== undefined) return ptyModule;
    try {
      ptyModule = require('node-pty');
    } catch (err) {
      ptyModule = null;
      logger.error('magocode-agent pty unavailable:', err.message);
    }
    return ptyModule;
  }

  function capabilities() {
    return CAPABILITIES.filter((capability) => capability !== 'pty' || Boolean(loadPty()));
  }

  // One structured line per privileged operation, so the host owner can
  // reconstruct what the server ran (journald keeps stdout).
  function audit(entry) {
    logger.log(JSON.stringify({ ts: new Date().toISOString(), event: 'agent.op', ...entry }));
  }

  function connect() {
    if (stopped) return;
    let cfg;
    try {
      cfg = configPath ? readConfig(configPath) : readConfig();
    } catch (err) {
      logger.error('magocode-agent config error:', err.message);
      scheduleReconnect();
      return;
    }

    const socket = new WebSocket(cfg.url, {
      headers: { 'X-API-Key': cfg.apiKey },
      maxPayload: SOCKET_MAX_PAYLOAD,
    });
    ws = socket;

    socket.on('open', () => {
      failedAttempts = 0;
      startHeartbeat(socket);
      send({
        type: 'hello',
        agentVersion: VERSION,
        protocolVersion: PROTOCOL_VERSION,
        os: process.platform,
        arch: process.arch,
        capabilities: capabilities(),
      });
      logger.log('magocode-agent connected');
    });

    socket.on('pong', () => {
      awaitingPong = false;
    });

    socket.on('message', (data) => {
      // Any inbound traffic proves the connection is alive.
      awaitingPong = false;
      let message;
      try {
        message = parseMessage(data);
      } catch (err) {
        send({ type: 'error', code: err.code || 'AGENT_PROTOCOL_ERROR', message: err.message });
        return;
      }

      const handler = isCommandType(message.type) ? handlers[message.type] : null;
      if (!handler) {
        // Never answer an error with an error.
        if (message.type === 'error') return;
        send({
          ...(message.id !== undefined ? { id: String(message.id) } : {}),
          type: 'error',
          code: 'EUNSUPPORTED',
          message: `unsupported message type: ${message.type}`,
        });
        return;
      }

      try {
        handler(message);
      } catch (err) {
        logger.error(`magocode-agent ${message.type} handler failed:`, err.message);
        send({
          ...(message.id !== undefined ? { id: String(message.id) } : {}),
          type: 'error',
          code: 'EINTERNAL',
          message: err.message,
        });
      }
    });

    socket.on('close', () => {
      // Stream and command state is connection-scoped: the server cannot
      // receive their output any more, so stop the work too.
      stopHeartbeat();
      stopAllTails('socket closed');
      killAllPtys();
      killAllExecs();
      if (ws === socket) ws = null;
      scheduleReconnect();
    });

    socket.on('error', (err) => {
      logger.error('magocode-agent socket error:', err.message);
    });
  }

  function scheduleReconnect() {
    if (stopped || reconnectTimer) return;
    failedAttempts += 1;
    const delay = nextReconnectDelay(failedAttempts, {
      baseMs: settings.reconnectMs,
      maxMs: settings.reconnectMaxMs,
    });
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, delay);
  }

  // The server pings at the application level, but a half-open connection
  // (NAT timeout, server gone without FIN) leaves readyState OPEN forever.
  // A protocol-level ping with a missed-pong check detects that and reuses
  // the normal close -> reconnect path.
  function startHeartbeat(socket) {
    stopHeartbeat();
    awaitingPong = false;
    heartbeatTimer = setInterval(() => {
      if (awaitingPong) {
        logger.error('magocode-agent heartbeat timed out; reconnecting');
        socket.terminate();
        return;
      }
      awaitingPong = true;
      try { socket.ping(); } catch { /* the next tick terminates the socket */ }
    }, settings.heartbeatMs);
  }

  function stopHeartbeat() {
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }

  // Delivery is at-most-once: a message produced while the socket is not
  // open is dropped, never queued (see docs/protocol.md).
  function send(message) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(serializeMessage(message));
      return true;
    }
    return false;
  }

  function allowedPath(id, candidate) {
    const resolved = resolveAllowedPath(String(candidate || ''), pathOptions);
    if (!resolved) {
      send({
        id,
        type: 'error',
        code: 'EACCES',
        message: `path must be under ${settings.home} or ${settings.tmpPrefix}*`,
      });
    }
    return resolved;
  }

  function startTail(message) {
    const id = String(message.id || '');
    if (!id || !message.path) return send({ id, type: 'error', code: 'EINVAL', message: 'id and path are required' });
    if (tails.has(id)) stopTail(id, 'restarted');
    const path = allowedPath(id, message.path);
    if (!path) return;
    if (tails.size >= MAX_TAILS) return send({ id, type: 'error', code: 'EBUSY', message: 'too many tails open' });

    const child = spawn('tail', ['-n', message.fromStart === false ? '0' : '+1', '-F', path], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    tails.set(id, child);
    audit({ op: 'tail.start', id, path });

    const rl = readline.createInterface({ input: child.stdout });
    rl.on('line', (line) => send({ id, type: 'tail.line', line }));
    child.stderr.on('data', (chunk) => {
      const text = chunk.toString('utf8').trim();
      if (text) send({ id, type: 'error', code: 'TAIL_STDERR', message: text });
    });
    child.on('close', () => {
      rl.close();
      if (tails.get(id) === child) {
        tails.delete(id);
        send({ id, type: 'tail.end', reason: 'closed' });
      }
    });
    child.on('error', (err) => {
      send({ id, type: 'error', code: err.code || 'TAIL_ERROR', message: err.message });
      stopTail(id, 'error');
    });
  }

  function runExec(message) {
    const id = String(message.id || '');
    const cmd = String(message.cmd || '');
    if (!id || !cmd) return send({ id, type: 'error', code: 'EINVAL', message: 'id and cmd are required' });
    if (execs.size >= MAX_CONCURRENT_EXECS) {
      return send({ id, type: 'error', code: 'EBUSY', message: 'too many commands running' });
    }
    const timeout = Math.max(1000, Math.min(Number(message.timeoutMs) || 30000, 10 * 60 * 1000));
    const startedAt = Date.now();
    const child = childExec(unwrapMagoCodeSuCommand(cmd), {
      cwd: settings.cwd,
      timeout,
      maxBuffer: EXEC_MAX_BUFFER,
      shell: settings.shell,
    }, (err, stdout, stderr) => {
      execs.delete(child);
      const outcome = mapExecOutcome(err, stdout, stderr, { aborted: abortedExecs.has(child) });
      audit({
        op: 'exec',
        id,
        cmd: cmd.slice(0, AUDIT_CMD_MAX_CHARS),
        code: outcome.code,
        durationMs: Date.now() - startedAt,
      });
      send({ id, ...outcome });
    });
    execs.add(child);
  }

  function killAllExecs() {
    for (const child of [...execs]) {
      abortedExecs.add(child);
      try { child.kill('SIGTERM'); } catch {}
    }
  }

  function writeFile(message) {
    const id = String(message.id || '');
    const path = allowedPath(id, message.path);
    if (!path) return;
    let mode = null;
    if (message.mode !== undefined && message.mode !== null && message.mode !== '') {
      mode = parseFileMode(message.mode);
      if (mode === null) {
        return send({ id, type: 'error', code: 'EINVAL', message: 'mode must be an octal file mode such as 600' });
      }
    }
    const data = Buffer.from(String(message.b64Contents || ''), 'base64');
    fs.writeFile(path, data, (err) => {
      if (err) return send({ id, type: 'error', code: err.code || 'EWRITE', message: err.message });
      audit({ op: 'writeFile', id, path, bytes: data.length });
      if (mode === null) return send({ id, type: 'writeFile.result' });
      fs.chmod(path, mode, (chmodErr) => {
        if (chmodErr) send({ id, type: 'error', code: chmodErr.code || 'ECHMOD', message: chmodErr.message });
        else send({ id, type: 'writeFile.result' });
      });
    });
  }

  function readFile(message) {
    const id = String(message.id || '');
    const path = allowedPath(id, message.path);
    if (!path) return;
    fs.stat(path, (statErr, stats) => {
      if (statErr) return send({ id, type: 'error', code: statErr.code || 'EREAD', message: statErr.message });
      if (stats.size > READ_FILE_MAX_BYTES) {
        return send({
          id,
          type: 'error',
          code: 'EFBIG',
          message: `file is larger than the ${READ_FILE_MAX_BYTES} byte read limit`,
        });
      }
      fs.readFile(path, (err, data) => {
        if (err) return send({ id, type: 'error', code: err.code || 'EREAD', message: err.message });
        audit({ op: 'readFile', id, path, bytes: data.length });
        send({ id, type: 'readFile.result', b64Contents: data.toString('base64') });
      });
    });
  }

  function fileExists(message) {
    const id = String(message.id || '');
    const path = allowedPath(id, message.path);
    if (!path) return;
    fs.access(path, fs.constants.F_OK, (err) => {
      send({ id, type: 'fileExists.result', exists: !err });
    });
  }

  function openPty(message) {
    const id = String(message.id || '');
    if (!id) return send({ id, type: 'error', code: 'EINVAL', message: 'id is required' });
    const pty = loadPty();
    if (!pty) return send({ id, type: 'error', code: 'PTY_UNAVAILABLE', message: 'pty support is not available on this agent' });
    if (ptys.has(id)) killPty(id);
    if (ptys.size >= MAX_PTYS) return send({ id, type: 'error', code: 'EBUSY', message: 'too many PTYs open' });
    const cols = Math.max(20, Math.min(500, parseInt(message.cols, 10) || 120));
    const rows = Math.max(5, Math.min(200, parseInt(message.rows, 10) || 40));
    const term = String(message.term || 'xterm-256color');
    const cmd = unwrapMagoCodeSuCommand(String(message.cmd || 'bash'));
    let child;
    try {
      child = pty.spawn(settings.shell, ['-lc', cmd], {
        name: term,
        cols,
        rows,
        cwd: settings.cwd,
        env: { ...process.env, TERM: term, HOME: settings.home, USER: settings.user },
      });
    } catch (err) {
      return send({ id, type: 'error', code: err.code || 'PTY_OPEN_FAILED', message: err.message });
    }
    ptys.set(id, child);
    audit({ op: 'pty.open', id, cmd: cmd.slice(0, AUDIT_CMD_MAX_CHARS) });
    child.onData((data) => {
      send({ id, type: 'pty.data', b64: Buffer.from(String(data), 'utf8').toString('base64') });
    });
    child.onExit(({ exitCode, signal }) => {
      if (ptys.get(id) !== child) return;
      ptys.delete(id);
      send({ id, type: 'pty.exit', code: typeof exitCode === 'number' ? exitCode : null, signal });
    });
  }

  function writePty(message) {
    const id = String(message.id || '');
    const child = ptys.get(id);
    if (!child) return send({ id, type: 'error', code: 'PTY_NOT_FOUND', message: 'PTY is not open' });
    try {
      child.write(Buffer.from(String(message.b64 || ''), 'base64').toString('utf8'));
    } catch (err) {
      send({ id, type: 'error', code: err.code || 'PTY_WRITE_FAILED', message: err.message });
    }
  }

  function resizePty(message) {
    const id = String(message.id || '');
    const child = ptys.get(id);
    if (!child) return;
    const cols = Math.max(20, Math.min(500, parseInt(message.cols, 10) || 120));
    const rows = Math.max(5, Math.min(200, parseInt(message.rows, 10) || 40));
    try { child.resize(cols, rows); } catch {}
  }

  function killPty(id) {
    const child = ptys.get(id);
    if (!child) return send({ id, type: 'pty.exit', code: null });
    ptys.delete(id);
    try { child.kill(); } catch {}
    send({ id, type: 'pty.exit', code: null });
  }

  function killAllPtys() {
    for (const id of [...ptys.keys()]) killPty(id);
  }

  function stopTail(id, reason) {
    const child = tails.get(id);
    if (!child) return;
    tails.delete(id);
    try { child.kill('SIGTERM'); } catch {}
    send({ id, type: 'tail.end', reason });
  }

  function stopAllTails(reason) {
    for (const id of [...tails.keys()]) stopTail(id, reason);
  }

  function stop() {
    stopped = true;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = null;
    stopHeartbeat();
    stopAllTails('shutdown');
    killAllPtys();
    killAllExecs();
    try { ws && ws.close(); } catch {}
  }

  const handlers = {
    ping: () => send({ type: 'pong' }),
    'tail.start': startTail,
    'tail.stop': (message) => stopTail(String(message.id || ''), 'stopped'),
    exec: runExec,
    writeFile,
    readFile,
    fileExists,
    'pty.open': openPty,
    'pty.write': writePty,
    'pty.resize': resizePty,
    'pty.kill': (message) => killPty(String(message.id || '')),
  };

  return {
    start: connect,
    stop,
    capabilities,
    commandTypes: Object.keys(handlers),
    settings,
  };
}

module.exports = {
  createAgent,
  readSettings,
  EXEC_MAX_BUFFER,
  READ_FILE_MAX_BYTES,
};
