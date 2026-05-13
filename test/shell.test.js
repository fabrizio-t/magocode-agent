'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { isAllowedMagoCodePath, unwrapMagoCodeSuCommand } = require('../src/shell.js');

describe('shell helpers', () => {
  it('unwraps magocode su commands', () => {
    assert.equal(
      unwrapMagoCodeSuCommand("su - magocode -c 'codex login --device-auth'"),
      'codex login --device-auth',
    );
  });

  it('preserves plain commands', () => {
    assert.equal(unwrapMagoCodeSuCommand('pwd'), 'pwd');
  });

  it('allows only magocode-scoped file paths', () => {
    assert.equal(isAllowedMagoCodePath('/home/magocode/magocode-logs/a.log'), true);
    assert.equal(isAllowedMagoCodePath('/tmp/magocode-abc'), true);
    assert.equal(isAllowedMagoCodePath('/etc/passwd'), false);
    assert.equal(isAllowedMagoCodePath('/home/magocode/a\0b'), false);
  });
});
