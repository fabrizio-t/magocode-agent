'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  MAX_MESSAGE_BYTES,
  isCommandType,
  isKnownType,
  parseMessage,
  serializeMessage,
} = require('../src/protocol.js');

describe('protocol', () => {
  it('parses object messages with a type', () => {
    assert.deepEqual(parseMessage('{"type":"ping"}'), { type: 'ping' });
  });

  it('serializes messages as JSON', () => {
    assert.equal(serializeMessage({ type: 'pong' }), '{"type":"pong"}');
  });

  it('validates known message types', () => {
    assert.equal(isKnownType('pty.open'), true);
    assert.equal(isKnownType('ping'), true);
    assert.equal(isKnownType('exec.result'), true);
    assert.equal(isKnownType('unknown'), false);
  });

  it('separates server commands from agent events', () => {
    assert.equal(isCommandType('ping'), true);
    assert.equal(isCommandType('exec'), true);
    assert.equal(isCommandType('exec.result'), false);
    assert.equal(isCommandType('hello'), false);
    assert.equal(isCommandType('unknown'), false);
  });

  it('rejects invalid messages', () => {
    assert.throws(() => parseMessage('{'), /invalid agent JSON/);
    assert.throws(() => parseMessage('[]'), /must be an object/);
    assert.throws(() => parseMessage('{}'), /missing type/);
  });

  it('rejects oversized messages before parsing them', () => {
    const oversized = JSON.stringify({ type: 'exec', cmd: 'x'.repeat(MAX_MESSAGE_BYTES) });
    assert.throws(() => parseMessage(oversized), { code: 'AGENT_MESSAGE_TOO_LARGE' });
  });
});
