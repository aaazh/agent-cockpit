import fs from 'fs';
import os from 'os';
import path from 'path';
import { resolveCliCommandForRuntime, buildCliCommandInvocation } from '../src/services/cliCommandResolver';
import { ensureWindowsCliToolWrappers } from '../src/services/windowsCliToolWrappers';

describe('Grok Windows executable and terminal wrappers', () => {
  const platform = Object.getOwnPropertyDescriptor(process, 'platform')!;
  let root: string;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'grok-windows-'));
    Object.defineProperty(process, 'platform', { value: 'win32' });
  });
  afterEach(() => {
    Object.defineProperty(process, 'platform', platform);
    fs.rmSync(root, { recursive: true, force: true });
  });
  function file(relative: string) {
    const filename = path.join(root, relative);
    fs.mkdirSync(path.dirname(filename), { recursive: true });
    fs.writeFileSync(filename, 'fixture');
    return filename;
  }

  test('prefers the installed native binary and falls back to the managed package through Node', () => {
    const native = file('user/.grok/bin/grok.exe');
    const entry = file('cli-tools/node_modules/@xai-official/grok/bin/grok');
    file('cli-tools/grok.cmd');
    const env = { USERPROFILE: path.join(root, 'user'), AGENT_COCKPIT_DATA_DIR: path.join(root, 'data'), PATH: '' };
    expect(resolveCliCommandForRuntime('grok-build', 'grok', env)).toMatchObject({ command: native });
    fs.unlinkSync(native);
    const runtime = resolveCliCommandForRuntime('grok-build', 'grok', env);
    expect(runtime).toMatchObject({ command: process.execPath, argsPrefix: [entry] });
    expect(buildCliCommandInvocation(runtime, ['--version'])).toEqual({ command: process.execPath, args: [entry, '--version'] });
    expect(resolveCliCommandForRuntime('grok-build', entry, env)).toMatchObject({ command: process.execPath, argsPrefix: [entry] });
  });

  test('repairs both terminal wrappers without requiring global Node', () => {
    const entry = file('cli-tools/node_modules/@xai-official/grok/bin/grok');
    const nodeExe = file('runtime/node.exe');
    const result = ensureWindowsCliToolWrappers({ cliToolsDir: path.join(root, 'cli-tools'), nodeExe, harnesses: ['grok-build'], requireTargets: true });
    expect(result).toMatchObject({ ok: true, updated: ['grok'] });
    const cmd = fs.readFileSync(path.join(root, 'cli-tools/grok.cmd'), 'utf8');
    const ps = fs.readFileSync(path.join(root, 'cli-tools/grok.ps1'), 'utf8');
    expect(cmd).toContain(`SET "NODE_EXE=${nodeExe}"`);
    expect(cmd).toContain(`SET "GROK_JS=${entry}"`);
    expect(cmd).toContain('"%NODE_EXE%" "%GROK_JS%" %*');
    expect(ps).toContain(`$node = '${nodeExe}'`);
    expect(ps).toContain('& $node $target @args');
    fs.unlinkSync(entry);
    expect(ensureWindowsCliToolWrappers({ cliToolsDir: path.join(root, 'cli-tools'), nodeExe, harnesses: ['grok-build'], requireTargets: true })).toMatchObject({ ok: false, error: expect.stringContaining('entrypoint is missing') });
  });
});
