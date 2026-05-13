'use strict';

const fs = require('fs');

const DEFAULT_CONFIG_PATH = process.env.MAGOCODE_AGENT_CONFIG || '/home/magocode/.magocode.json';

function instanceToAgentUrl(instance) {
  const base = String(instance || '').replace(/\/$/, '');
  if (!base) throw new Error('instance is required');
  if (base.startsWith('https://')) return `wss://${base.slice('https://'.length)}/agent`;
  if (base.startsWith('http://')) return `ws://${base.slice('http://'.length)}/agent`;
  if (base.startsWith('wss://') || base.startsWith('ws://')) return `${base}/agent`;
  throw new Error('instance must start with https://, http://, wss://, or ws://');
}

function readConfig(path = DEFAULT_CONFIG_PATH) {
  const cfg = JSON.parse(fs.readFileSync(path, 'utf8'));
  if (!cfg.instance || !cfg.apiKey) throw new Error('instance and apiKey are required');
  return {
    url: instanceToAgentUrl(cfg.instance),
    apiKey: cfg.apiKey,
  };
}

module.exports = {
  DEFAULT_CONFIG_PATH,
  instanceToAgentUrl,
  readConfig,
};
