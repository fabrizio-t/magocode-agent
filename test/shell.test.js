'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  isAllowedMagoCodePath,
  parseFileMode,
  resolveAllowedPath,
  unwrapMagoCodeSuCommand,
} = require('../src/shell.js');

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

  it('rejects paths that walk out of the allowed roots', () => {
    assert.equal(isAllowedMagoCodePath('/home/magocode/../../etc/shadow'), false);
    assert.equal(isAllowedMagoCodePath('/home/magocode/repos/../../other/.ssh/id_rsa'), false);
    assert.equal(isAllowedMagoCodePath('/tmp/magocode-abc/../../etc/passwd'), false);
    assert.equal(isAllowedMagoCodePath('/home/magocode-evil/file'), false);
    assert.equal(isAllowedMagoCodePath('/home/magocode'), false);
    assert.equal(isAllowedMagoCodePath('relative/path'), false);
    assert.equal(isAllowedMagoCodePath(''), false);
    assert.equal(isAllowedMagoCodePath(null), false);
  });

  it('returns the normalized path that was checked', () => {
    assert.equal(
      resolveAllowedPath('/home/magocode/repos/../magocode-logs//a.log'),
      '/home/magocode/magocode-logs/a.log',
    );
    assert.equal(resolveAllowedPath('/etc/passwd'), null);
  });

  it('honours a configured home and tmp prefix', () => {
    const options = { home: '/home/deploy', tmpPrefix: '/tmp/deploy-' };
    assert.equal(isAllowedMagoCodePath('/home/deploy/app/log.txt', options), true);
    assert.equal(isAllowedMagoCodePath('/tmp/deploy-1', options), true);
    assert.equal(isAllowedMagoCodePath('/home/magocode/app/log.txt', options), false);
    assert.equal(isAllowedMagoCodePath('/tmp/magocode-1', options), false);
  });

  it('parses octal file modes', () => {
    assert.equal(parseFileMode('600'), 0o600);
    assert.equal(parseFileMode('0600'), 0o600);
    assert.equal(parseFileMode('0o755'), 0o755);
    assert.equal(parseFileMode(' 644 '), 0o644);
    assert.equal(parseFileMode(0o640), 0o640);
  });

  it('rejects values that are not file modes', () => {
    for (const bad of ['rw-r--r--', '9', '888', '77777', '', '-1', '6 0 0', {}, [], null, undefined, NaN, 1.5, -1, 0o10000]) {
      assert.equal(parseFileMode(bad), null, `expected ${String(bad)} to be rejected`);
    }
  });
});
