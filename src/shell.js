'use strict';

function unescapeShellSingleQuotes(value) {
  return String(value).replace(/'\\''/g, "'");
}

function unwrapTaskitSuCommand(cmd) {
  cmd = String(cmd || '').trim();
  const prefix = "su - taskit -c '";
  const doublePrefix = 'su - taskit -c "';
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

function isAllowedTaskitPath(path) {
  return typeof path === 'string'
    && path.length > 0
    && !path.includes('\0')
    && (path.startsWith('/home/taskit/') || path.startsWith('/tmp/taskit-'));
}

module.exports = {
  unescapeShellSingleQuotes,
  unwrapTaskitSuCommand,
  isAllowedTaskitPath,
};
