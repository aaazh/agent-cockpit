import fs from 'fs';
import os from 'os';
import path from 'path';

test('monitor-only startup never creates native runtime services or applies pending imports', () => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cockpit-monitor-startup-'));
  const startMonitorServer = jest.fn();
  const createChatRouter = jest.fn();
  const ChatService = jest.fn();
  const BackendRegistry = jest.fn();
  const UpdateService = jest.fn();
  const applyPendingImport = jest.fn();
  jest.doMock('../src/services/monitorServer', () => ({ ...jest.requireActual('../src/services/monitorServer'), startMonitorServer }));
  jest.doMock('../src/routes/chat', () => ({ createChatRouter }));
  jest.doMock('../src/services/chatService', () => ({ ChatService }));
  jest.doMock('../src/services/backends/registry', () => ({ BackendRegistry }));
  jest.doMock('../src/services/updateService', () => ({ UpdateService }));
  jest.doMock('../src/services/dataMigrationService', () => ({ DataMigrationService: { applyPendingImport } }));
  jest.doMock('../src/config', () => ({
    __esModule: true,
    default: {
      PORT: 0, HOST: '127.0.0.1', MONITOR_ONLY: true,
      SESSION_SECRET: 'isolated-test-session-secret',
      AGENT_COCKPIT_DATA_DIR: dataRoot, AUTH_DATA_DIR: path.join(dataRoot, 'auth'),
      AUTH_SETUP_TOKEN: 'isolated-test-setup-token', AUTH_ENABLE_LEGACY_OAUTH: false,
      EXTERNAL_SESSION_SOURCE_URL: '', EXTERNAL_SESSION_SOURCE_TOKEN: '',
    },
  }));
  try {
    jest.isolateModules(() => { require('../server'); });
    expect(startMonitorServer).toHaveBeenCalledTimes(1);
    expect(startMonitorServer.mock.calls[0][1]).toMatchObject({ HOST: '127.0.0.1', MONITOR_ONLY: true });
    expect(ChatService).not.toHaveBeenCalled();
    expect(BackendRegistry).not.toHaveBeenCalled();
    expect(createChatRouter).not.toHaveBeenCalled();
    expect(UpdateService).not.toHaveBeenCalled();
    expect(applyPendingImport).not.toHaveBeenCalled();
    expect(fs.existsSync(path.join(dataRoot, 'chat'))).toBe(false);
  } finally { fs.rmSync(dataRoot, { recursive: true, force: true }); }
});
