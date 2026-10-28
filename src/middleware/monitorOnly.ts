import type { Request, Response, NextFunction } from '../types';
import type { Server } from 'http';

/** Monitoring transcripts require an owner session even on loopback. */
export function requireOwnerAuth(req: Request, res: Response, next: NextFunction): void {
  if (req.isAuthenticated()) { next(); return; }
  if (req.path.startsWith('/api/') || req.baseUrl.startsWith('/api/')) {
    res.status(401).json({ error: 'Not authenticated' }); return;
  }
  res.redirect(`/auth/login?${new URLSearchParams({ next: req.originalUrl })}`);
}

/** Deny the whole native execution surface, including side-effecting GETs. */
export function rejectMonitorExecution(_req: Request, res: Response): void {
  res.status(403).json({ error: 'This server is in read-only monitoring mode', code: 'MONITOR_ONLY' });
}

export function rejectMonitorWebSockets(server: Server): void {
  server.on('upgrade', (_req, socket) => {
    socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
  });
}
