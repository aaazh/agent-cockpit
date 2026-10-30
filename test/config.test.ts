import path from 'path';

describe('config data root', () => {
  const originalEnv = { ...process.env };

  function loadConfig() {
    // Reload after env changes; dynamic import requires explicit extensions
    // under NodeNext, while Jest's CJS require handles this test case cleanly.
    return require('../src/config').default;
  }

  afterEach(() => {
    process.env = { ...originalEnv };
    jest.resetModules();
  });

  test('defaults mutable data under the process data directory', async () => {
    process.env.AGENT_COCKPIT_DATA_DIR = '';
    process.env.AUTH_DATA_DIR = '';
    jest.resetModules();

    const config = loadConfig();

    expect(config.AGENT_COCKPIT_DATA_DIR).toBe(path.join(process.cwd(), 'data'));
    expect(config.AUTH_DATA_DIR).toBe(path.join(process.cwd(), 'data', 'auth'));
  });

  test('keeps native mode and external sources disabled unless configured', () => {
    delete process.env.MONITOR_ONLY;
    process.env.MONITOR_PUBLIC_READ = 'true';
    delete process.env.EXTERNAL_SESSION_SOURCE_URL;
    delete process.env.EXTERNAL_SESSION_SOURCE_TOKEN;
    delete process.env.HOST;
    delete process.env.UPDATE_REPOSITORY;
    jest.resetModules();
    expect(loadConfig()).toMatchObject({
      MONITOR_ONLY: false, MONITOR_PUBLIC_READ: false, EXTERNAL_SESSION_SOURCE_URL: '', EXTERNAL_SESSION_SOURCE_TOKEN: '',
      HOST: '0.0.0.0', UPDATE_REPOSITORY: 'aaazh/agent-cockpit',
    });
    process.env.MONITOR_ONLY = 'true';
    process.env.HOST = '127.0.0.1';
    jest.resetModules();
    expect(loadConfig()).toMatchObject({ MONITOR_ONLY: true, MONITOR_PUBLIC_READ: true, HOST: '127.0.0.1' });
  });

  test('derives auth storage from AGENT_COCKPIT_DATA_DIR unless AUTH_DATA_DIR is explicit', async () => {
    const dataRoot = path.join(process.cwd(), 'tmp-data-root');
    process.env.AGENT_COCKPIT_DATA_DIR = dataRoot;
    process.env.AUTH_DATA_DIR = '';
    jest.resetModules();

    let config = loadConfig();
    expect(config.AGENT_COCKPIT_DATA_DIR).toBe(dataRoot);
    expect(config.AUTH_DATA_DIR).toBe(path.join(dataRoot, 'auth'));

    const authDir = path.join(process.cwd(), 'custom-auth-root');
    process.env.AUTH_DATA_DIR = authDir;
    jest.resetModules();

    config = loadConfig();
    expect(config.AGENT_COCKPIT_DATA_DIR).toBe(dataRoot);
    expect(config.AUTH_DATA_DIR).toBe(authDir);
  });
});
