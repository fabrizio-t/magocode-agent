'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { nextReconnectDelay } = require('../src/backoff.js');

const noJitter = { baseMs: 5000, maxMs: 60000, jitter: 0 };

describe('reconnect backoff', () => {
  it('starts at the base delay and doubles', () => {
    assert.equal(nextReconnectDelay(1, noJitter), 5000);
    assert.equal(nextReconnectDelay(2, noJitter), 10000);
    assert.equal(nextReconnectDelay(3, noJitter), 20000);
  });

  it('caps at the maximum delay', () => {
    assert.equal(nextReconnectDelay(5, noJitter), 60000);
    assert.equal(nextReconnectDelay(1000, noJitter), 60000);
  });

  it('spreads delays within the jitter range', () => {
    const options = { baseMs: 5000, maxMs: 60000, jitter: 0.2 };
    assert.equal(nextReconnectDelay(1, { ...options, random: () => 0 }), 4000);
    assert.equal(nextReconnectDelay(1, { ...options, random: () => 1 }), 6000);
  });

  it('treats a missing or invalid attempt as the first one', () => {
    assert.equal(nextReconnectDelay(0, noJitter), 5000);
    assert.equal(nextReconnectDelay(undefined, noJitter), 5000);
  });

  it('never goes below the base when the maximum is misconfigured lower', () => {
    assert.equal(nextReconnectDelay(4, { baseMs: 5000, maxMs: 1000, jitter: 0 }), 5000);
  });
});
