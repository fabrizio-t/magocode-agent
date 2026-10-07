'use strict';

const nodePath = require('path');

const DEFAULT_HOME = '/home/magocode';
const DEFAULT_TMP_PREFIX = '/tmp/magocode-';

function unescapeShellSingleQuotes(value) {
  return String(value).replace(/'\\''/g, "'");
}

function unwrapMagoCodeSuCommand(cmd) {
  cmd = String(cmd || '').trim();
  const prefix = "su - magocode -c '";
  const doublePrefix = 'su - magocode -c "';
  const activePrefix = cmd.startsWith(prefix) ? prefix : (cmd.startsWith(doublePrefix) ? doublePrefix : '');
  if (!activePrefix) return cmd;
  const quote = activePrefix === prefix ? "'" : '"';
  let i = activePrefix.length;
  let inner = '';
  while (i < cmd.length) {
    if (cmd.slice(i, i + 4) === "'\\''") {
      inner += "'";
      i += 4;
      continue;
    }
    if (cmd[i] === quote) {
      const suffix = cmd.slice(i + 1).trim();
      if (!suffix || suffix === '2>/dev/null') return inner;
      return `${inner} ${suffix}`;
    }
    inner += cmd[i];
    i++;
  }
  return unescapeShellSingleQuotes(cmd);
}

// The agent runs on Linux, where `path` is `path.posix`. Picking the
// implementation from the configured home keeps the same code testable on
// other platforms with a native temp directory as home.
function pathImplFor(home) {
  return String(home).startsWith('/') ? nodePath.posix : nodePath;
}

/**
 * Return the normalized path when it lies under the agent home or the agent
 * tmp prefix, otherwise null. Normalizing first means `..` segments cannot
 * walk out of the allowed roots, and callers operate on the same path that
 * was checked.
 *
 * This is a guardrail, not a security boundary: it does not resolve symlinks,
 * and `exec` already grants full access as the agent user.
 */
function resolveAllowedPath(candidate, { home = DEFAULT_HOME, tmpPrefix = DEFAULT_TMP_PREFIX } = {}) {
  if (typeof candidate !== 'string' || !candidate || candidate.includes('\0')) return null;
  const impl = pathImplFor(home);
  if (!impl.isAbsolute(candidate)) return null;
  const resolved = impl.normalize(candidate);
  const homeRoot = impl.normalize(home).replace(/[\\/]+$/, '') + impl.sep;
  if (resolved.startsWith(homeRoot)) return resolved;
  if (tmpPrefix && resolved.startsWith(impl.normalize(tmpPrefix))) return resolved;
  return null;
}

function isAllowedMagoCodePath(candidate, options) {
  return resolveAllowedPath(candidate, options) !== null;
}

/**
 * Parse a file mode sent over the wire. Accepts octal strings ("600", "0600",
 * "0o600") or an integer already holding the mode bits. Returns the integer
 * mode, or null when the value is not a valid mode.
 */
function parseFileMode(mode) {
  if (typeof mode === 'number') {
    return Number.isInteger(mode) && mode >= 0 && mode <= 0o7777 ? mode : null;
  }
  if (typeof mode !== 'string') return null;
  const match = /^(?:0o)?([0-7]{1,4})$/.exec(mode.trim());
  return match ? parseInt(match[1], 8) : null;
}

module.exports = {
  DEFAULT_HOME,
  DEFAULT_TMP_PREFIX,
  unescapeShellSingleQuotes,
  unwrapMagoCodeSuCommand,
  resolveAllowedPath,
  isAllowedMagoCodePath,
  parseFileMode,
};
