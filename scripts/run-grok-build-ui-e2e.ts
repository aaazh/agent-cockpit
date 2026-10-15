import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import net from 'net';
import { spawn, spawnSync } from 'child_process';
import { resolveGrokCliRuntime } from '../src/services/backends/grokRuntime';
import { buildCliCommandInvocation } from '../src/services/cliCommandResolver';

async function main(): Promise<void> {
  const cwd = process.cwd();
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cockpit-grok-ui-'));
  const workspace = path.join(root, 'Desktop', 'grok-fixture');
  const data = path.join(root, 'data');
  await fs.mkdir(workspace, { recursive: true });
  await fs.mkdir(path.join(data, 'chat'), { recursive: true });
  await fs.writeFile(path.join(workspace, 'AGENTS.md'), '# Compatibility fixture\nWork only in this fixture directory. No web, native memory, external connectors, scheduling, publishing, or unrelated work.\n');
  const profileId = 'grok-certify';
  const now = new Date().toISOString();
  await fs.writeFile(path.join(data, 'chat', 'settings.json'), JSON.stringify({
    theme: 'light', sendBehavior: 'enter', systemPrompt: 'Scoped compatibility fixture: only perform the exact requested task.',
    defaultBackend: 'grok-build', defaultCliProfileId: profileId, workingDirectory: workspace,
    cliProfiles: [{ id: profileId, name: 'Grok Certification', harness: 'grok-build', authMode: 'server-configured', command: 'grok', createdAt: now, updatedAt: now }],
    workspaceContext: { scanIntervalMinutes: 1440, cliConcurrency: 1 },
  }, null, 2));
  const build = spawnSync(process.execPath, [path.join(cwd, 'node_modules/vite/bin/vite.js'), 'build', '--config', 'web/AgentCockpitWeb/vite.config.ts'], { cwd, stdio: 'inherit', env: { ...process.env, NODE_ENV: 'production' } });
  if (build.status !== 0) throw new Error('Production web build failed');
  const mobileBuild = spawnSync(process.execPath, [path.join(cwd, 'mobile/AgentCockpitPWA/node_modules/vite/bin/vite.js'), 'build'], {
    cwd: path.join(cwd, 'mobile/AgentCockpitPWA'), stdio: 'inherit', env: { ...process.env, NODE_ENV: 'production' },
  });
  if (mobileBuild.status !== 0) throw new Error('Production mobile build failed');
  const port = await new Promise<number>((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address() as net.AddressInfo;
      server.close(() => resolve(address.port));
    });
  });
  const app = `grok-ui-${process.pid}`;
  const config = path.join(root, 'ecosystem.config.cjs');
  await fs.writeFile(config, `module.exports=${JSON.stringify({ apps: [{ name: app, cwd, script: 'server.ts', interpreter: process.execPath, node_args: ['--import', 'tsx'], autorestart: false,
    env: { NODE_ENV: 'test', PORT: port, BASE_PATH: '', AGENT_COCKPIT_DATA_DIR: data, AUTH_DATA_DIR: path.join(data, 'auth'), DEFAULT_WORKSPACE: workspace,
      SESSION_SECRET: `grok-ui-fixture-${process.pid}`, WEB_BUILD_MODE: 'skip', GROK_DISABLE_AUTOUPDATER: '1' },
    out_file: path.join(root, 'server-out.log'), error_file: path.join(root, 'server-error.log'),
  }] })};\n`);
  const pm2 = (args: string[]) => spawnSync(process.execPath, [path.join(cwd, 'node_modules/pm2/bin/pm2'), ...args], { cwd, stdio: 'inherit' });
  let exitCode = 1;
  try {
    if (pm2(['start', config, '--only', app]).status !== 0) throw new Error('Fixture PM2 startup failed');
    const baseUrl = `http://127.0.0.1:${port}`;
    let ready = false;
    for (let i = 0; i < 120; i++) {
      try { ready = (await fetch(`${baseUrl}/api/chat/version`, { signal: AbortSignal.timeout(1000) })).ok; } catch { /* starting */ }
      if (ready) break;
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    if (!ready) throw new Error('Fixture server did not become ready');
    exitCode = await new Promise<number>((resolve, reject) => {
      const child = spawn(process.execPath, [path.join(cwd, 'node_modules/playwright/cli.js'), 'test', 'test/e2e/grokBuild.ui.pw.ts', '--config', 'playwright.config.ts', '--project', 'chromium', ...process.argv.slice(2)], {
        cwd, stdio: 'inherit', env: { ...process.env, GROK_BUILD_UI_E2E: '1', GROK_BUILD_UI_WORKSPACE: workspace, GROK_BUILD_UI_PROFILE_ID: profileId, AGENT_COCKPIT_E2E_BASE_URL: baseUrl },
      });
      child.once('error', reject);
      child.once('exit', code => resolve(code ?? 1));
    });
  } finally {
    pm2(['delete', app]);
    const runtime = resolveGrokCliRuntime();
    const invocation = buildCliCommandInvocation(runtime, ['--version']);
    const version = spawnSync(invocation.command, invocation.args, { encoding: 'utf8', env: runtime.env }).stdout?.trim() || 'unavailable';
    const revision = spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout?.trim() || null;
    const dirty = Boolean(spawnSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).stdout?.trim());
    await fs.writeFile(path.join(root, 'compatibility-report.json'), JSON.stringify({ startedAt: now, finishedAt: new Date().toISOString(), revision, dirty, platform: process.platform, arch: process.arch, nodeVersion: process.version, grokVersion: version, exitCode }, null, 2));
    process.stdout.write(`Grok UI compatibility artifacts: ${root}\n`);
  }
  process.exitCode = exitCode;
}

main().catch(error => { process.stderr.write(`${(error as Error).stack || error}\n`); process.exitCode = 1; });
