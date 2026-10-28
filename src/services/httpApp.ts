import path from 'path';
import express from 'express';
import session from 'express-session';
import FileStoreFactory from 'session-file-store';
import { setupAuth, requireAuth, meHandler } from '../middleware/auth';
import { ensureCsrfToken } from '../middleware/csrf';
import { applySecurity } from '../middleware/security';
import { HttpExternalSessionSource } from './externalSessionSource';
import { createExternalSessionRouter } from '../routes/externalSessions';
import { requireOwnerAuth } from '../middleware/monitorOnly';
import type { AppConfig, Request, Response, NextFunction } from '../types';

const FileStore = FileStoreFactory(session);

/** Shared owner authentication and monitoring HTTP composition; imports no native runtimes. */
export function createCockpitHttpApp(config: AppConfig, appRoot: string) {
  const app = express();

  app.set('trust proxy', 1);

  applySecurity(app);

  const sessionStore = new FileStore({
    path: path.join(config.AGENT_COCKPIT_DATA_DIR, 'sessions'),
    ttl: 24 * 60 * 60,
    retries: process.platform === 'win32' ? 3 : 0,
  });

  app.use(session({
    store: sessionStore,
    secret: config.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    // Rolling: every authenticated request resets cookie.maxAge so an active
    // user never hits the 24h wall mid-workflow. Idle users still expire after
    // 24h of no activity.
    rolling: true,
    cookie: {
      secure: 'auto',
      httpOnly: true,
      sameSite: 'lax',
      maxAge: 24 * 60 * 60 * 1000,
    },
  }));

  // Passport 0.7 regenerate/save polyfill — must come BEFORE setupAuth
  app.use((req: Request, _res: Response, next: NextFunction) => {
    if (req.session && !req.session.regenerate) {
      (req.session as any).regenerate = (cb: () => void) => cb();
    }
    if (req.session && !req.session.save) {
      (req.session as any).save = (cb: () => void) => cb();
    }
    next();
  });

  // Public brand asset — served without auth so /auth/login can render the
  // Agent Cockpit logo. One targeted route instead of a blanket public-asset
  // mount, so the rest of public/ stays behind requireAuth.
  app.get('/logo-full-no-text.svg', (_req: Request, res: Response): void => {
    res.sendFile(path.join(appRoot, 'public', 'logo-full-no-text.svg'));
  });

  setupAuth(app, config);

  app.use(requireAuth);
  app.use(ensureCsrfToken);

  app.use(express.json());

  app.get('/api/csrf-token', (req: Request, res: Response) => {
    res.json({ csrfToken: req.session.csrfToken });
  });

  app.get('/api/me', meHandler);

  const externalSource = config.EXTERNAL_SESSION_SOURCE_URL
    ? new HttpExternalSessionSource(config.EXTERNAL_SESSION_SOURCE_URL, config.EXTERNAL_SESSION_SOURCE_TOKEN)
    : null;
  app.use('/api/monitoring', createExternalSessionRouter(externalSource, config.MONITOR_ONLY));
  app.use('/monitor', requireOwnerAuth, express.static(path.join(appRoot, 'public', 'monitor')));
  return { app, sessionStore };
}
