import type { Express } from 'express';
import type { AppConfig } from '../types';
import { rejectMonitorExecution, rejectMonitorWebSockets } from '../middleware/monitorOnly';
import { logger } from '../utils/logger';

export function mountMonitorOnlyRoutes(app: Express): void {
  app.use('/api/chat', rejectMonitorExecution);
  app.get(['/', '/v2', '/v2/*', '/mobile', '/mobile/*'], (_req, res) => { res.redirect('/monitor/'); });
}

/** No ChatService, model adapter, MCP listener, scheduler or updater is started. */
export function startMonitorServer(app: Express, config: AppConfig): void {
  const log = logger.child({ module: 'monitor-server' });
  const server = app.listen(config.PORT, config.HOST, () => {
    log.info('Read-only monitoring server listening', { host: config.HOST, port: config.PORT });
  });
  server.on('error', (error) => { log.error('Monitoring server failed', { error }); process.exitCode = 1; });
  rejectMonitorWebSockets(server);
  const shutdown = () => {
    server.close(() => { process.exitCode = 0; });
    server.closeIdleConnections();
    const deadline = setTimeout(() => { server.closeAllConnections(); }, 10_000);
    deadline.unref();
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}
