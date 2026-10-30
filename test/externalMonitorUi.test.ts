/** @jest-environment jsdom */
import fs from 'fs';
import path from 'path';

const now = '2026-01-01T00:00:00Z';
const run = { id: 'run-1', conversationId: 'conversation-1', status: 'running', createdAt: now };

describe('external monitor UI', () => {
  let fetchMock: jest.Mock;

  async function flush() { for (let i = 0; i < 15; i++) await Promise.resolve(); }

  beforeEach(() => {
    jest.useFakeTimers();
    document.body.innerHTML = fs.readFileSync(path.join(__dirname, '../public/monitor/index.html'), 'utf8').split('<body>')[1].split('</body>')[0];
    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
    fetchMock = jest.fn(async (url: string) => ({
      ok: true, status: 200,
      json: async () => url.endsWith('/status') ? { enabled: true, monitorOnly: true }
        : url.includes('/transcript') ? { run, messages: [{ role: 'assistant', content: '<img src=x onerror=alert(1)>', createdAt: now }], events: [] }
          : { items: [run], nextCursor: 'next-page' },
    }));
    window.fetch = fetchMock;
    window.eval(fs.readFileSync(path.join(__dirname, '../public/monitor/monitor.js'), 'utf8'));
  });

  afterEach(() => {
    window.dispatchEvent(new Event('pagehide'));
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  test('renders read-only list/detail and uses text nodes for untrusted content', async () => {
    await flush();
    expect(document.getElementById('cockpit-link')!.hidden).toBe(true);
    expect(document.querySelectorAll('.run')).toHaveLength(1);
    (document.querySelector('.run') as HTMLButtonElement).click();
    await flush();
    expect(document.querySelector('.content')!.textContent).toContain('<img src=x');
    expect(document.querySelector('.detail img')).toBeNull();
    expect(document.querySelector('textarea')).toBeNull();
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/runs/run-1/transcript'))).toBe(true);
    expect(fetchMock.mock.calls.every(([, init]) => init.credentials === 'same-origin' && !init.headers)).toBe(true);
  });

  test('hides account sign-out and explains the explicitly public read view', async () => {
    fetchMock.mockImplementation(async (url: string) => ({
      ok: true, status: 200,
      json: async () => url.endsWith('/status') ? { enabled: true, monitorOnly: true, publicRead: true } : { items: [run] },
    }));
    await flush();
    // Reinitialize against the current server status after the default bootstrap settles.
    window.dispatchEvent(new Event('pagehide'));
    window.eval(fs.readFileSync(path.join(__dirname, '../public/monitor/monitor.js'), 'utf8'));
    await flush();
    expect(document.getElementById('signout-link')!.hidden).toBe(true);
    expect(document.getElementById('public-read-note')!.hidden).toBe(false);
    expect(document.querySelectorAll('.run')).toHaveLength(1);
  });

  test('polls every four seconds, preserves details, pauses while hidden, and paginates', async () => {
    await flush();
    const count = fetchMock.mock.calls.length;
    await jest.advanceTimersByTimeAsync(4000);
    expect(fetchMock.mock.calls.length).toBe(count + 1);
    (document.getElementById('older') as HTMLButtonElement).click();
    await flush();
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('cursor=next-page'))).toBe(true);
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    document.dispatchEvent(new Event('visibilitychange'));
    const hiddenCount = fetchMock.mock.calls.length;
    await jest.advanceTimersByTimeAsync(12000);
    expect(fetchMock.mock.calls.length).toBe(hiddenCount);
  });
});
