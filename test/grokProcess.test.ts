import { spawn, type ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import fsp from 'fs/promises';
import os from 'os';
import path from 'path';
import { GrokProcessScope, grokDescendants, parseGrokProcessTable } from '../src/services/backends/grokProcess';

test('process ownership follows ancestry across detached groups and excludes siblings', () => {
  const table = parseGrokProcessTable('10 1 10 Mon Oct 12 10:00:00 2026\n12 10 12 Mon Oct 12 10:00:01 2026\n13 12 12 Mon Oct 12 10:00:02 2026\n20 1 20 Mon Oct 12 10:00:03 2026\n');
  expect(grokDescendants(table, 10).map(process => process.pid)).toEqual([10, 12, 13]);
});

const posixTest = process.platform === 'win32' ? test.skip : test;
posixTest('reaps a separately detached tool after CLI death while leaving unrelated work alive', async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'grok-process-scope-'));
  const pidFile = path.join(dir, 'child.pid');
  const childProgram = 'process.on("SIGTERM", () => {}); setInterval(() => {}, 1000);';
  const rootProgram = `const fs=require('fs');const {spawn}=require('child_process');const child=spawn(process.execPath,['-e',${JSON.stringify(childProgram)}],{detached:true,stdio:'ignore'});fs.writeFileSync(${JSON.stringify(pidFile)},String(child.pid));setInterval(()=>{},1000);`;
  const root = spawn(process.execPath, ['-e', rootProgram], { detached: true, stdio: 'ignore' });
  const unrelated = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { detached: true, stdio: 'ignore' });
  const scope = new GrokProcessScope(root);
  scope.watch();
  let childPid: number | undefined;
  const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
  try {
    for (let i = 0; i < 100; i++) {
      try { childPid = Number(await fsp.readFile(pidFile, 'utf8')); break; } catch { await new Promise(resolve => setTimeout(resolve, 20)); }
    }
    expect(childPid).toBeGreaterThan(0);
    await new Promise(resolve => setTimeout(resolve, 750));
    const exited = new Promise(resolve => root.once('exit', resolve));
    root.kill('SIGKILL');
    await exited;
    scope.stop();
    for (let i = 0; i < 100 && alive(childPid!); i++) await new Promise(resolve => setTimeout(resolve, 50));
    expect(alive(childPid!)).toBe(false);
    expect(alive(unrelated.pid!)).toBe(true);
  } finally {
    scope.stop(); root.kill(); unrelated.kill();
    if (childPid) { try { process.kill(childPid, 'SIGKILL'); } catch { /* fixture already reaped */ } }
    await fsp.rm(dir, { recursive: true, force: true });
  }
});

describe('process scope containment edges', () => {
  const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform')!;
  let kill: jest.SpyInstance;
  // Fake timers keep the SIGKILL escalation from firing real signals after a test ends.
  beforeEach(() => { jest.useFakeTimers(); kill = jest.spyOn(process, 'kill').mockImplementation(() => true); });
  afterEach(() => {
    jest.clearAllTimers(); jest.useRealTimers(); kill.mockRestore();
    Object.defineProperty(process, 'platform', originalPlatform);
    jest.dontMock('child_process'); jest.resetModules();
  });
  const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };
  const table = (stdout: string) => (_command: string, _args: string[], _options: unknown, callback: (error: Error | null, result?: { stdout: string }) => void) => callback(null, { stdout });
  function loadScope(mocks: Record<string, jest.Mock>): typeof GrokProcessScope {
    jest.doMock('child_process', () => ({ ...jest.requireActual('child_process'), ...mocks }));
    let loaded!: typeof import('../src/services/backends/grokProcess');
    jest.isolateModules(() => { loaded = require('../src/services/backends/grokProcess'); });
    return loaded.GrokProcessScope;
  }

  posixTest('falls back to killing the CLI group when process enumeration fails during stop', async () => {
    const Scope = loadScope({ execFile: jest.fn((_command, _args, _options, callback) => callback(new Error('ps unavailable'))) });
    new Scope({ pid: 4242, exitCode: null, signalCode: null } as unknown as ChildProcess).stop();
    await flush();
    expect(kill).toHaveBeenCalledWith(-4242, 'SIGKILL');
  });

  posixTest('signals only owned descendants whose start identity is unchanged, then escalates', async () => {
    const execFile = jest.fn()
      .mockImplementationOnce(table('100 1 100 T0\n101 100 101 T1\n102 100 100 T2\n200 1 200 T3\n'))
      .mockImplementationOnce(table('100 1 100 T0\n101 100 101 T1\n102 1 102 REUSED\n200 1 200 T3\n'))
      .mockImplementationOnce(table('101 1 101 T1\n102 1 102 REUSED\n'));
    const scope = new (loadScope({ execFile }))({ pid: 100, exitCode: null, signalCode: null } as unknown as ChildProcess);
    scope.watch();
    await flush();
    scope.stop();
    await flush();
    expect(kill.mock.calls).toEqual([[-100, 'SIGTERM'], [-101, 'SIGTERM'], [100, 'SIGTERM'], [101, 'SIGTERM']]);
    kill.mockClear();
    await jest.advanceTimersByTimeAsync(2_000);
    await flush();
    expect(kill.mock.calls).toEqual([[-101, 'SIGKILL'], [101, 'SIGKILL']]);
  });

  test('Windows stops the CLI tree with taskkill and falls back to a direct kill', () => {
    Object.defineProperty(process, 'platform', { value: 'win32' });
    const killer = new EventEmitter();
    const execFile = jest.fn();
    const spawnTaskkill = jest.fn(() => killer);
    const child = { pid: 77, kill: jest.fn() };
    const scope = new (loadScope({ execFile, spawn: spawnTaskkill }))(child as unknown as ChildProcess);
    scope.watch();
    scope.stop();
    scope.stop();
    expect(execFile).not.toHaveBeenCalled();
    expect(spawnTaskkill.mock.calls).toEqual([['taskkill', ['/pid', '77', '/t', '/f'], expect.objectContaining({ windowsHide: true })]]);
    killer.emit('error', new Error('taskkill unavailable'));
    expect(child.kill).toHaveBeenCalledTimes(1);
  });
});
