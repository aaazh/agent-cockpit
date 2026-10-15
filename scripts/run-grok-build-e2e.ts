import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { spawn, spawnSync } from 'child_process';
import { resolveGrokCliRuntime } from '../src/services/backends/grokRuntime';
import { buildCliCommandInvocation } from '../src/services/cliCommandResolver';

async function main(): Promise<void> {
  const startedAt = new Date().toISOString();
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cockpit-grok-compat-'));
  const runtime = resolveGrokCliRuntime();
  const invocation = buildCliCommandInvocation(runtime, ['--version']);
  const grokVersion = spawnSync(invocation.command, invocation.args, { encoding: 'utf8', env: runtime.env }).stdout?.trim() || 'unavailable';
  const revision = spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout?.trim() || null;
  const dirty = Boolean(spawnSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).stdout?.trim());
  let output = '';
  const exitCode = await new Promise<number>((resolve, reject) => {
    const child = spawn(process.execPath, ['--experimental-vm-modules', path.join(process.cwd(), 'node_modules/jest/bin/jest.js'),
      'test/grokBuild.e2e.test.ts', 'test/grokWorkflows.e2e.test.ts', '--runInBand', ...process.argv.slice(2)], {
      env: { ...process.env, GROK_BUILD_E2E: '1' }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.on('data', chunk => { output += chunk.toString(); process.stdout.write(chunk); });
    child.stderr.on('data', chunk => { output += chunk.toString(); process.stderr.write(chunk); });
    child.once('error', reject);
    child.once('exit', code => resolve(code ?? 1));
  });
  await fs.writeFile(path.join(root, 'tests.log'), output);
  await fs.writeFile(path.join(root, 'compatibility-report.json'), JSON.stringify({ startedAt, finishedAt: new Date().toISOString(),
    revision, dirty, platform: process.platform, arch: process.arch, nodeVersion: process.version, grokVersion, exitCode }, null, 2));
  process.stdout.write(`Grok compatibility artifacts: ${root}\n`);
  process.exitCode = exitCode;
}

main().catch(error => { process.stderr.write(`${(error as Error).stack || error}\n`); process.exitCode = 1; });
