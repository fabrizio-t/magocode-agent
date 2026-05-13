'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { instanceToAgentUrl } = require('../src/config.js');

describe('config', () => {
  it('maps HTTP(S) instances to WebSocket agent URLs', () => {
    assert.equal(instanceToAgentUrl('https://api.magocode.com'), 'wss://api.magocode.com/agent');
    assert.equal(instanceToAgentUrl('http://localhost:3000/'), 'ws://localhost:3000/agent');
  });

  it('accepts explicit WebSocket instances', () => {
    assert.equal(instanceToAgentUrl('ws://localhost:3000'), 'ws://localhost:3000/agent');
    assert.equal(instanceToAgentUrl('wss://example.test/'), 'wss://example.test/agent');
  });

  it('rejects unsupported instances', () => {
    assert.throws(() => instanceToAgentUrl('api.magocode.com'), /instance must start/);
  });
});
