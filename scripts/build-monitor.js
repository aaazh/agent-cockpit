#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const { build } = require('esbuild');

const root = path.join(__dirname, '..');
const output = path.join(root, 'monitor-dist');

async function main() {
  fs.rmSync(output, { recursive: true, force: true });
  const result = await build({
    absWorkingDir: root,
    entryPoints: ['monitor.ts'],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    outfile: path.join(output, 'monitor.cjs'),
    metafile: true,
    logLevel: 'warning',
  });
  const inputs = Object.keys(result.metafile.inputs);
  const forbidden = inputs.filter(input => /(?:^|\/)(?:backends|chatService|dataMigrationService|memoryMcp|kbSearchMcp|routines|node-pty|better-sqlite3|@napi-rs|@electric-sql)(?:\/|\.|$)/.test(input));
  if (forbidden.length) throw new Error(`Native runtime included in monitoring build: ${forbidden.join(', ')}`);
  const assets = path.join(output, 'public');
  fs.mkdirSync(assets, { recursive: true });
  fs.cpSync(path.join(root, 'public', 'monitor'), path.join(assets, 'monitor'), { recursive: true });
  fs.copyFileSync(path.join(root, 'public', 'logo-full-no-text.svg'), path.join(assets, 'logo-full-no-text.svg'));
  const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  const digest = crypto.createHash('sha256').update(fs.readFileSync(path.join(output, 'monitor.cjs'))).digest('hex');
  fs.writeFileSync(path.join(output, 'manifest.json'), JSON.stringify({ mode: 'monitor-only', commit, sha256: digest, nativeRuntimeInputs: forbidden }, null, 2) + '\n');
  process.stdout.write('Monitoring bundle built without native runtime dependencies.\n');
}

main().catch(error => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
