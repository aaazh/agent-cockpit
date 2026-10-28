import http from 'http';
import express from 'express';
import { WebSocket } from 'ws';
import { HttpExternalSessionSource } from '../src/services/externalSessionSource';
import { createExternalSessionRouter } from '../src/routes/externalSessions';
import { rejectMonitorExecution, rejectMonitorWebSockets } from '../src/middleware/monitorOnly';
import { parseExternalRunList, parseExternalTranscript } from '../src/contracts/externalSessions';

const run = { id: 'run-1', conversationId: 'conversation-1', status: 'running', createdAt: '2026-01-01T00:00:00Z' };
const transcript = { run, messages: [{ role: 'assistant', content: 'Hello', createdAt: run.createdAt }], events: [{ seq: 1, type: 'tool', data: { name: 'search' }, createdAt: run.createdAt }] };

async function withServer(handler: http.RequestListener, fn: (base: string, server: http.Server) => Promise<void>) {
  const server = http.createServer(handler);
  await new Promise<void>(resolve => { server.listen(0, '127.0.0.1', resolve); });
  try { await fn(`http://127.0.0.1:${(server.address() as { port: number }).port}`, server); }
  finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => { server.close(() => resolve()); });
  }
}

describe('external session source', () => {
  test('uses only the fixed read endpoints, bearer token and validated responses', async () => {
    const requests: Array<{ url: string; auth: string | undefined; method: string | undefined }> = [];
    await withServer((req, res) => {
      requests.push({ url: req.url!, auth: req.headers.authorization, method: req.method });
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(req.url!.includes('transcript') ? transcript : { items: [{ ...run, privateSecret: 'omit' }], nextCursor: 'next' }));
    }, async (base) => {
      const source = new HttpExternalSessionSource(base, 'server-only-token');
      expect(await source.listRuns('page 2')).toEqual({ items: [run], nextCursor: 'next' });
      expect(await source.getTranscript('run-1')).toEqual(transcript);
    });
    expect(requests).toEqual([
      { url: '/internal/monitoring/runs?cursor=page+2', auth: 'Bearer server-only-token', method: 'GET' },
      { url: '/internal/monitoring/runs/run-1/transcript', auth: 'Bearer server-only-token', method: 'GET' },
    ]);
  });

  test.each(['http://example.com', 'https://user:pass@example.com', 'https://example.com/prefix', 'https://example.com?x=1', 'file:///tmp/runs'])('rejects unsafe base %s', (url) => {
    expect(() => new HttpExternalSessionSource(url, 'token')).toThrow();
  });

  test('requires a token and rejects path traversal before any network call', async () => {
    expect(() => new HttpExternalSessionSource('https://example.com', '')).toThrow();
    expect(() => new HttpExternalSessionSource('https://example.com', 'token\r\nheader')).toThrow();
    await expect(new HttpExternalSessionSource('https://example.com', 'token').getTranscript('../escape')).rejects.toThrow('Invalid run id');
  });

  test('does not follow upstream redirects or expose error bodies', async () => {
    await withServer((_req, res) => { res.writeHead(302, { location: '/secret' }); res.end('sensitive body'); }, async base => {
      await expect(new HttpExternalSessionSource(base, 'token').listRuns()).rejects.toThrow();
    });
    await withServer((_req, res) => { res.writeHead(403); res.end('sensitive body'); }, async base => {
      await expect(new HttpExternalSessionSource(base, 'token').listRuns()).rejects.toThrow('Monitoring source unavailable');
    });
  });

  test('rejects oversized responses and mismatched run identity', async () => {
    await withServer((_req, res) => { res.end('x'.repeat(2 * 1024 * 1024 + 1)); }, async base => {
      await expect(new HttpExternalSessionSource(base, 'token').listRuns()).rejects.toThrow('too large');
    });
    await withServer((_req, res) => { res.end(JSON.stringify(transcript)); }, async base => {
      await expect(new HttpExternalSessionSource(base, 'token').getTranscript('other-run')).rejects.toThrow('Invalid monitoring response');
    });
  });

  test('validates status, timestamps, roles, event sequences and list bounds', () => {
    expect(() => parseExternalRunList({ items: [{ ...run, status: 'unknown' }] })).toThrow();
    expect(() => parseExternalRunList({ items: [{ ...run, createdAt: 'invalid' }] })).toThrow();
    expect(() => parseExternalRunList({ items: Array(201).fill(run) })).toThrow();
    expect(() => parseExternalTranscript({ ...transcript, messages: [{ role: 'system' }] })).toThrow();
    expect(() => parseExternalTranscript({ ...transcript, events: [{ ...transcript.events[0], seq: -1 }] })).toThrow();
  });
});

describe('read-only monitoring routes', () => {
  function app(owner = true, source: HttpExternalSessionSource | null = null) {
    const application = express();
    application.use((req, _res, next) => { req.isAuthenticated = (() => owner) as typeof req.isAuthenticated; next(); });
    application.use('/api/monitoring', createExternalSessionRouter(source, true));
    application.use('/api/chat', rejectMonitorExecution);
    return application;
  }

  test('requires owner auth even on loopback and reports disabled source without credentials', async () => {
    await withServer(app(false), async base => {
      expect((await fetch(`${base}/api/monitoring/status`)).status).toBe(401);
      expect((await fetch(`${base}/api/monitoring/runs`)).status).toBe(401);
    });
    await withServer(app(), async base => {
      const response = await fetch(`${base}/api/monitoring/status`);
      expect(await response.json()).toEqual({ enabled: false, monitorOnly: true, pollIntervalMs: 4000 });
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect((await fetch(`${base}/api/monitoring/runs`)).status).toBe(503);
    });
  });

  test('sanitizes upstream failures and rejects malformed IDs/cursors', async () => {
    const source = new HttpExternalSessionSource('https://example.com', 'secret-token');
    const list = jest.spyOn(source, 'listRuns').mockRejectedValue(new Error('secret-token'));
    await withServer(app(true, source), async base => {
      const response = await fetch(`${base}/api/monitoring/runs`);
      expect(response.status).toBe(502);
      expect(await response.text()).not.toContain('secret-token');
      expect((await fetch(`${base}/api/monitoring/runs?cursor[a]=b`)).status).toBe(400);
      expect((await fetch(`${base}/api/monitoring/runs/bad%2Fid/transcript`)).status).toBe(400);
    });
    expect(list).toHaveBeenCalledTimes(1);
  });

  test.each(['GET', 'POST', 'PATCH', 'DELETE'])('rejects native execution surface for %s', async method => {
    await withServer(app(), async base => {
      for (const path of ['conversations/id/message', 'conversations/id/abort', 'memory', 'kb/dream', 'routines/id/run', 'update']) {
        const response = await fetch(`${base}/api/chat/${path}`, { method });
        expect(response.status).toBe(403);
        expect(await response.json()).toMatchObject({ code: 'MONITOR_ONLY' });
      }
    });
  });

  test('rejects websocket upgrades, including authenticated/native resume paths', async () => {
    await withServer(app(), async (base, server) => {
      rejectMonitorWebSockets(server);
      const status = await new Promise<number>((resolve, reject) => {
        const ws = new WebSocket(`${base.replace('http:', 'ws:')}/api/chat/conversations/id/ws`);
        ws.on('unexpected-response', (_req, response) => { response.resume(); resolve(response.statusCode!); ws.terminate(); });
        ws.on('error', () => {});
        ws.on('open', () => { ws.close(); reject(new Error('Execution websocket opened')); });
      });
      expect(status).toBe(403);
    });
  });
});
