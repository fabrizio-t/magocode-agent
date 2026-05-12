'use strict';

const MAX_MESSAGE_BYTES = 1024 * 1024;
const KNOWN_TYPES = new Set([
  'hello',
  'pong',
  'exec',
  'exec.result',
  'writeFile',
  'writeFile.result',
  'readFile',
  'readFile.result',
  'fileExists',
  'fileExists.result',
  'tail.start',
  'tail.stop',
  'tail.line',
  'tail.end',
  'pty.open',
  'pty.write',
  'pty.resize',
  'pty.kill',
  'pty.data',
  'pty.exit',
  'error',
]);

function parseMessage(data, { maxBytes = MAX_MESSAGE_BYTES } = {}) {
  const text = Buffer.isBuffer(data) ? data.toString('utf8') : String(data || '');
  if (Buffer.byteLength(text, 'utf8') > maxBytes) {
    const err = new Error('agent message too large');
    err.code = 'AGENT_MESSAGE_TOO_LARGE';
    throw err;
  }
  let message;
  try {
    message = JSON.parse(text);
  } catch {
    const err = new Error('invalid agent JSON message');
    err.code = 'AGENT_PROTOCOL_INVALID_JSON';
    throw err;
  }
  if (!message || typeof message !== 'object' || Array.isArray(message)) {
    const err = new Error('agent message must be an object');
    err.code = 'AGENT_PROTOCOL_INVALID_MESSAGE';
    throw err;
  }
  if (typeof message.type !== 'string' || !message.type) {
    const err = new Error('agent message missing type');
    err.code = 'AGENT_PROTOCOL_MISSING_TYPE';
    throw err;
  }
  return message;
}

function serializeMessage(message) {
  return JSON.stringify(message);
}

function isKnownType(type) {
  return KNOWN_TYPES.has(type);
}

module.exports = {
  MAX_MESSAGE_BYTES,
  parseMessage,
  serializeMessage,
  isKnownType,
};
