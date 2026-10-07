'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const pkg = require('../package.json');
const { PROTOCOL_VERSION, VERSION } = require('../src/version.js');

const installScript = fs.readFileSync(path.join(__dirname, '..', 'install.sh'), 'utf8');

function installDefault(name) {
  const match = new RegExp(`^${name}="([^"]*)"`, 'm').exec(installScript);
  assert.ok(match, `${name} is not defined in install.sh`);
  return match[1];
}

describe('release consistency', () => {
  it('reports the package version in the hello handshake', () => {
    assert.equal(VERSION, pkg.version);
    assert.match(VERSION, /^\d+\.\d+\.\d+$/);
  });

  it('exposes an integer protocol version', () => {
    assert.equal(Number.isInteger(PROTOCOL_VERSION), true);
  });

  it('installs the release tag that matches the package version, never a branch', () => {
    assert.equal(installDefault('DEFAULT_AGENT_REF'), `v${pkg.version}`);
  });

  it('installs from the published repository', () => {
    assert.equal(installDefault('DEFAULT_AGENT_REPO'), 'https://github.com/fabrizio-t/magocode-agent.git');
  });

  it('installs dependencies from the lockfile', () => {
    assert.ok(fs.existsSync(path.join(__dirname, '..', 'package-lock.json')), 'package-lock.json is missing');
    assert.match(installScript, /npm ci --omit=dev/);
    assert.doesNotMatch(installScript, /npm install --omit=dev/);
  });
});
