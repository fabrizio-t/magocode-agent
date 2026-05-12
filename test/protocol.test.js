'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { isKnownType, parseMessage, serializeMessage } = require('../src/protocol.js');

describe('protocol', () => {
  it('parses object messages with a type', () => {
    assert.deepEqual(parseMessage('{"type":"ping"}'), { type: 'ping' });
  });

  it('serializes messages as JSON', () => {
    assert.equal(serializeMessage({ type: 'pong' }), '{"type":"pong"}');
  });

  it('validates known message types', () => {
    assert.equal(isKnownType('pty.open'), true);
    assert.equal(isKnownType('unknown'), false);
  });

  it('rejects invalid messages', () => {
    assert.throws(() => parseMessage('{'), /invalid agent JSON/);
    assert.throws(() => parseMessage('[]'), /must be an object/);
    assert.throws(() => parseMessage('{}'), /missing type/);
  });
});
