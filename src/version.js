'use strict';

// Single source of truth is package.json: the release tag, the installer
// default ref, and the `hello` handshake must all agree (test/version.test.js).
const { version } = require('../package.json');

module.exports = {
  VERSION: version,
  // Bump when a change is not backwards compatible on the wire. Additive
  // fields and new message types do not need a bump.
  PROTOCOL_VERSION: 1,
  CAPABILITIES: ['tail', 'exec', 'writeFile', 'readFile', 'fileExists', 'pty'],
};
