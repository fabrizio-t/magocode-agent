'use strict';

const os = require('os');

const EXEC_FAILED_CODE = 1;

function signalExitCode(signal) {
  const number = os.constants.signals[signal];
  // Shell convention: a process killed by signal N exits with 128 + N.
  return typeof number === 'number' ? 128 + number : EXEC_FAILED_CODE;
}

function withNote(stderr, note) {
  const text = String(stderr || '');
  if (!text) return note;
  return text.endsWith('\n') ? `${text}${note}` : `${text}\n${note}`;
}

/**
 * Turn the (err, stdout, stderr) triple from child_process.exec into the wire
 * message for the server (without the request id).
 *
 * A failed command must never be reported as exit code 0. Node reports several
 * failures with a non-numeric `err.code`:
 *   - output over maxBuffer  -> 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER'
 *   - spawn failure          -> 'ENOENT', 'EACCES', ... (e.g. missing cwd)
 *   - killed by a signal     -> null, with `err.signal` set
 * Each of those maps to a non-zero `code` plus `errorCode` / `signal` /
 * `truncated` so the server can tell them apart.
 */
function mapExecOutcome(err, stdout, stderr, { aborted = false } = {}) {
  const out = String(stdout || '');
  const errOut = String(stderr || '');

  if (!err) {
    return { type: 'exec.result', stdout: out, stderr: errOut, code: 0 };
  }

  if (aborted) {
    return { type: 'error', code: 'EABORTED', message: 'command aborted: agent connection closed' };
  }

  if (err.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') {
    return {
      type: 'exec.result',
      stdout: out,
      stderr: withNote(errOut, '[magocode-agent] output limit exceeded; command terminated and output truncated'),
      code: EXEC_FAILED_CODE,
      errorCode: 'EOUTPUTTOOLARGE',
      truncated: true,
    };
  }

  // exec() sets `killed` when its own timeout fired.
  if (err.killed) {
    return { type: 'error', code: 'ETIMEDOUT', message: 'command timed out' };
  }

  if (typeof err.code === 'number') {
    return {
      type: 'exec.result',
      stdout: out,
      stderr: errOut,
      code: err.code,
      ...(err.signal ? { signal: err.signal } : {}),
    };
  }

  if (err.signal) {
    return {
      type: 'exec.result',
      stdout: out,
      stderr: withNote(errOut, `[magocode-agent] command terminated by ${err.signal}`),
      code: signalExitCode(err.signal),
      signal: err.signal,
    };
  }

  return {
    type: 'exec.result',
    stdout: out,
    stderr: errOut || String(err.message || 'command failed to run'),
    code: EXEC_FAILED_CODE,
    errorCode: typeof err.code === 'string' && err.code ? err.code : 'EXEC_FAILED',
  };
}

module.exports = {
  EXEC_FAILED_CODE,
  mapExecOutcome,
  signalExitCode,
};
