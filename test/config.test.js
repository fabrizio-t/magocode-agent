'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { instanceToAgentUrl } = require('../src/config.js');

describe('config', () => {
  it('maps HTTP(S) instances to WebSocket agent URLs', () => {
    assert.equal(instanceToAgentUrl('https://taskit.fly.dev'), 'wss://taskit.fly.dev/agent');
    assert.equal(instanceToAgentUrl('http://localhost:3000/'), 'ws://localhost:3000/agent');
  });

  it('accepts explicit WebSocket instances', () => {
    assert.equal(instanceToAgentUrl('ws://localhost:3000'), 'ws://localhost:3000/agent');
    assert.equal(instanceToAgentUrl('wss://example.test/'), 'wss://example.test/agent');
  });

  it('rejects unsupported instances', () => {
    assert.throws(() => instanceToAgentUrl('taskit.fly.dev'), /instance must start/);
  });
});
