'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');

const { mapExecOutcome, signalExitCode } = require('../src/exec.js');

function execError(fields) {
  return Object.assign(new Error(fields.message || 'Command failed'), fields);
}

describe('exec outcome mapping', () => {
  it('reports success as code 0', () => {
    assert.deepEqual(mapExecOutcome(null, 'out', 'err'), {
      type: 'exec.result',
      stdout: 'out',
      stderr: 'err',
      code: 0,
    });
  });

  it('passes a numeric exit code through', () => {
    const outcome = mapExecOutcome(execError({ code: 3 }), '', 'boom');
    assert.equal(outcome.type, 'exec.result');
    assert.equal(outcome.code, 3);
    assert.equal(outcome.stderr, 'boom');
  });

  it('never reports truncated output as success', () => {
    const outcome = mapExecOutcome(
      execError({ code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' }),
      'partial',
      '',
    );
    assert.equal(outcome.type, 'exec.result');
    assert.notEqual(outcome.code, 0);
    assert.equal(outcome.truncated, true);
    assert.equal(outcome.errorCode, 'EOUTPUTTOOLARGE');
    assert.equal(outcome.stdout, 'partial');
    assert.match(outcome.stderr, /output limit exceeded/);
  });

  it('never reports a command that failed to spawn as success', () => {
    const outcome = mapExecOutcome(execError({ code: 'ENOENT', message: 'spawn /bin/bash ENOENT' }), '', '');
    assert.equal(outcome.type, 'exec.result');
    assert.notEqual(outcome.code, 0);
    assert.equal(outcome.errorCode, 'ENOENT');
    assert.equal(outcome.stderr, 'spawn /bin/bash ENOENT');
  });

  it('never reports a signal-killed command as success', () => {
    const outcome = mapExecOutcome(execError({ code: null, signal: 'SIGKILL' }), 'partial', '');
    assert.equal(outcome.type, 'exec.result');
    assert.equal(outcome.code, 128 + os.constants.signals.SIGKILL);
    assert.equal(outcome.signal, 'SIGKILL');
    assert.match(outcome.stderr, /terminated by SIGKILL/);
  });

  it('falls back to a non-zero code when nothing identifies the failure', () => {
    const outcome = mapExecOutcome(execError({ code: null }), '', '');
    assert.notEqual(outcome.code, 0);
    assert.equal(outcome.errorCode, 'EXEC_FAILED');
  });

  it('keeps reporting the exec timeout as ETIMEDOUT', () => {
    assert.deepEqual(mapExecOutcome(execError({ killed: true, code: null, signal: 'SIGTERM' }), '', ''), {
      type: 'error',
      code: 'ETIMEDOUT',
      message: 'command timed out',
    });
  });

  it('labels commands killed by a dropped connection as aborted, not timed out', () => {
    const outcome = mapExecOutcome(execError({ killed: true, code: null, signal: 'SIGTERM' }), '', '', { aborted: true });
    assert.equal(outcome.type, 'error');
    assert.equal(outcome.code, 'EABORTED');
  });

  it('maps unknown signals to a generic failure code', () => {
    assert.notEqual(signalExitCode('SIGNOTREAL'), 0);
  });
});
