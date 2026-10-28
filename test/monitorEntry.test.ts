import fs from 'fs';
import os from 'os';
import path from 'path';

function configuration(dataRoot: string, enabled: boolean) {
  return {
    PORT: 0, HOST: '127.0.0.1', MONITOR_ONLY: enabled,
    SESSION_SECRET: 'isolated-monitor-entry-session-secret',
    AGENT_COCKPIT_DATA_DIR: dataRoot, AUTH_DATA_DIR: path.join(dataRoot, 'auth'),
    AUTH_SETUP_TOKEN: 'isolated-monitor-entry-setup-token', AUTH_ENABLE_LEGACY_OAUTH: false,
    EXTERNAL_SESSION_SOURCE_URL: '', EXTERNAL_SESSION_SOURCE_TOKEN: '',
  };
}

test('standalone monitor entry starts shared owner app without loading native runtime modules', () => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cockpit-monitor-entry-'));
  const startMonitorServer = jest.fn();
  const nativeImport = jest.fn(() => { throw new Error('Native runtime must not be loaded'); });
  for (const module of ['../src/services/chatService', '../src/services/backends/registry', '../src/services/dataMigrationService']) jest.doMock(module, nativeImport);
  jest.doMock('../src/services/monitorServer', () => ({
    ...jest.requireActual('../src/services/monitorServer'), startMonitorServer,
  }));
  jest.doMock('../src/config', () => ({ __esModule: true, default: configuration(dataRoot, true) }));
  try {
    jest.isolateModules(() => { require('../monitor'); });
    expect(startMonitorServer).toHaveBeenCalledTimes(1);
    expect(startMonitorServer.mock.calls[0][1]).toMatchObject({ HOST: '127.0.0.1', MONITOR_ONLY: true });
    expect(nativeImport).not.toHaveBeenCalled();
    expect(fs.existsSync(path.join(dataRoot, 'chat'))).toBe(false);
  } finally { fs.rmSync(dataRoot, { recursive: true, force: true }); }
});

test('standalone entry refuses configuration that could enable native execution', () => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cockpit-monitor-entry-disabled-'));
  const startMonitorServer = jest.fn();
  jest.doMock('../src/services/monitorServer', () => ({
    ...jest.requireActual('../src/services/monitorServer'), startMonitorServer,
  }));
  jest.doMock('../src/config', () => ({ __esModule: true, default: configuration(dataRoot, false) }));
  try {
    expect(() => jest.isolateModules(() => { require('../monitor'); })).toThrow('requires MONITOR_ONLY=true');
    expect(startMonitorServer).not.toHaveBeenCalled();
    expect(fs.readdirSync(dataRoot)).toEqual([]);
  } finally { fs.rmSync(dataRoot, { recursive: true, force: true }); }
});
