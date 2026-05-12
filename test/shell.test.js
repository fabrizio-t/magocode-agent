'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { isAllowedTaskitPath, unwrapTaskitSuCommand } = require('../src/shell.js');

describe('shell helpers', () => {
  it('unwraps taskit su commands', () => {
    assert.equal(
      unwrapTaskitSuCommand("su - taskit -c 'codex login --device-auth'"),
      'codex login --device-auth',
    );
  });

  it('preserves plain commands', () => {
    assert.equal(unwrapTaskitSuCommand('pwd'), 'pwd');
  });

  it('allows only taskit-scoped file paths', () => {
    assert.equal(isAllowedTaskitPath('/home/taskit/taskit-logs/a.log'), true);
    assert.equal(isAllowedTaskitPath('/tmp/taskit-abc'), true);
    assert.equal(isAllowedTaskitPath('/etc/passwd'), false);
    assert.equal(isAllowedTaskitPath('/home/taskit/a\0b'), false);
  });
});
