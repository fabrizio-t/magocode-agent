#!/usr/bin/env node
'use strict';

const fs = require('fs');
const readline = require('readline');
const { exec: childExec, spawn } = require('child_process');
const WebSocket = require('ws');
const pty = require('node-pty');

const { readConfig } = require('./config.js');
const { parseMessage, serializeMessage } = require('./protocol.js');
const { isAllowedTaskitPath, unwrapTaskitSuCommand } = require('./shell.js');
const { CAPABILITIES, VERSION } = require('./version.js');

const RECONNECT_MS = Number(process.env.MAGOCODE_AGENT_RECONNECT_MS || 5000);
const DEFAULT_CWD = process.env.MAGOCODE_AGENT_CWD || '/home/taskit';

let ws = null;
let reconnectTimer = null;
const tails = new Map();
const ptys = new Map();

function connect() {
  let cfg;
  try {
    cfg = readConfig();
  } catch (err) {
    console.error('magocode-agent config error:', err.message);
    scheduleReconnect();
    return;
  }

  ws = new WebSocket(cfg.url, { headers: { 'X-API-Key': cfg.apiKey } });

  ws.on('open', () => {
    send({
      type: 'hello',
      agentVersion: VERSION,
      os: process.platform,
      arch: process.arch,
      capabilities: CAPABILITIES,
    });
    console.log('magocode-agent connected');
  });

  ws.on('message', (data) => {
    let message;
    try {
      message = parseMessage(data);
    } catch {
      return;
    }

    if (message.type === 'ping') return send({ type: 'pong' });
    if (message.type === 'tail.start') return startTail(message);
    if (message.type === 'tail.stop') return stopTail(String(message.id || ''), 'stopped');
    if (message.type === 'exec') return runExec(message);
    if (message.type === 'writeFile') return writeFile(message);
    if (message.type === 'readFile') return readFile(message);
    if (message.type === 'fileExists') return fileExists(message);
    if (message.type === 'pty.open') return openPty(message);
    if (message.type === 'pty.write') return writePty(message);
    if (message.type === 'pty.resize') return resizePty(message);
    if (message.type === 'pty.kill') return killPty(String(message.id || ''));
  });

  ws.on('close', () => {
    stopAllTails('socket closed');
    killAllPtys();
    scheduleReconnect();
  });

  ws.on('error', (err) => {
    console.error('magocode-agent socket error:', err.message);
  });
}

function scheduleReconnect() {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, RECONNECT_MS);
}

function send(message) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(serializeMessage(message));
  }
}

function startTail(message) {
  const id = String(message.id || '');
  const path = String(message.path || '');
  if (!id || !path) return send({ id, type: 'error', code: 'EINVAL', message: 'id and path are required' });
  if (tails.has(id)) stopTail(id, 'restarted');
  if (!path.startsWith('/home/taskit/')) {
    return send({ id, type: 'error', code: 'EACCES', message: 'tail path must be under /home/taskit' });
  }

  const child = spawn('tail', ['-n', message.fromStart === false ? '0' : '+1', '-F', path], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  tails.set(id, child);

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

function assertTaskitPath(id, path) {
  if (!isAllowedTaskitPath(path)) {
    send({ id, type: 'error', code: 'EACCES', message: 'path must be under /home/taskit or /tmp/taskit-*' });
    return false;
  }
  return true;
}

function runExec(message) {
  const id = String(message.id || '');
  const cmd = String(message.cmd || '');
  if (!id || !cmd) return send({ id, type: 'error', code: 'EINVAL', message: 'id and cmd are required' });
  const timeout = Math.max(1000, Math.min(Number(message.timeoutMs) || 30000, 10 * 60 * 1000));
  childExec(unwrapTaskitSuCommand(cmd), {
    cwd: DEFAULT_CWD,
    timeout,
    maxBuffer: 1024 * 1024,
    shell: '/bin/bash',
  }, (err, stdout, stderr) => {
    if (err && err.killed) return send({ id, type: 'error', code: 'ETIMEDOUT', message: 'command timed out' });
    send({
      id,
      type: 'exec.result',
      stdout: String(stdout || ''),
      stderr: String(stderr || ''),
      code: typeof err?.code === 'number' ? err.code : 0,
    });
  });
}

function writeFile(message) {
  const id = String(message.id || '');
  const path = String(message.path || '');
  if (!assertTaskitPath(id, path)) return;
  let data;
  try {
    data = Buffer.from(String(message.b64Contents || ''), 'base64');
  } catch {
    return send({ id, type: 'error', code: 'EINVAL', message: 'invalid b64Contents' });
  }
  fs.writeFile(path, data, (err) => {
    if (err) return send({ id, type: 'error', code: err.code || 'EWRITE', message: err.message });
    if (message.mode) {
      fs.chmod(path, parseInt(String(message.mode).replace(/^0o/, ''), 8), (chmodErr) => {
        if (chmodErr) send({ id, type: 'error', code: chmodErr.code || 'ECHMOD', message: chmodErr.message });
        else send({ id, type: 'writeFile.result' });
      });
      return;
    }
    send({ id, type: 'writeFile.result' });
  });
}

function readFile(message) {
  const id = String(message.id || '');
  const path = String(message.path || '');
  if (!assertTaskitPath(id, path)) return;
  fs.readFile(path, (err, data) => {
    if (err) return send({ id, type: 'error', code: err.code || 'EREAD', message: err.message });
    send({ id, type: 'readFile.result', b64Contents: data.toString('base64') });
  });
}

function fileExists(message) {
  const id = String(message.id || '');
  const path = String(message.path || '');
  if (!assertTaskitPath(id, path)) return;
  fs.access(path, fs.constants.F_OK, (err) => {
    send({ id, type: 'fileExists.result', exists: !err });
  });
}

function openPty(message) {
  const id = String(message.id || '');
  if (!id) return send({ id, type: 'error', code: 'EINVAL', message: 'id is required' });
  if (ptys.has(id)) killPty(id);
  const cols = Math.max(20, Math.min(500, parseInt(message.cols, 10) || 120));
  const rows = Math.max(5, Math.min(200, parseInt(message.rows, 10) || 40));
  const term = String(message.term || 'xterm-256color');
  const cmd = unwrapTaskitSuCommand(String(message.cmd || 'bash'));
  let child;
  try {
    child = pty.spawn('/bin/bash', ['-lc', cmd], {
      name: term,
      cols,
      rows,
      cwd: DEFAULT_CWD,
      env: { ...process.env, TERM: term, HOME: DEFAULT_CWD, USER: 'taskit' },
    });
  } catch (err) {
    return send({ id, type: 'error', code: err.code || 'PTY_OPEN_FAILED', message: err.message });
  }
  ptys.set(id, child);
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

function shutdown() {
  stopAllTails('shutdown');
  killAllPtys();
  try { ws && ws.close(); } catch {}
  process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

connect();
