export const EXTERNAL_RUN_STATUSES = ['queued', 'running', 'cancelling', 'completed', 'failed', 'cancelled', 'timed_out'] as const;
export type ExternalRunStatus = typeof EXTERNAL_RUN_STATUSES[number];

export interface ExternalRun {
  id: string;
  conversationId: string;
  status: ExternalRunStatus;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  error?: string;
  usage?: Record<string, unknown>;
}

export interface ExternalRunList {
  items: ExternalRun[];
  nextCursor?: string;
}

export interface ExternalTranscript {
  run: ExternalRun;
  messages: Array<{ role: 'user' | 'assistant'; content: string; createdAt: string }>;
  events: Array<{ seq: number; type: string; data: unknown; createdAt: string }>;
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid monitoring response');
  return value as Record<string, unknown>;
}

function text(value: unknown, max = 100_000): string {
  if (typeof value !== 'string' || value.length > max) throw new Error('Invalid monitoring response');
  return value;
}

function timestamp(value: unknown): string {
  const result = text(value, 64);
  if (!Number.isFinite(Date.parse(result))) throw new Error('Invalid monitoring response');
  return result;
}

export function parseExternalRun(value: unknown): ExternalRun {
  const run = record(value);
  const id = text(run.id, 200);
  if (!/^[a-zA-Z0-9_-]{1,200}$/.test(id)) throw new Error('Invalid monitoring response');
  if (!EXTERNAL_RUN_STATUSES.includes(run.status as ExternalRunStatus)) throw new Error('Invalid monitoring response');
  return {
    id,
    conversationId: text(run.conversationId, 200),
    status: run.status as ExternalRunStatus,
    createdAt: timestamp(run.createdAt),
    ...(run.startedAt ? { startedAt: timestamp(run.startedAt) } : {}),
    ...(run.finishedAt ? { finishedAt: timestamp(run.finishedAt) } : {}),
    ...(run.error ? { error: text(run.error, 4000) } : {}),
    ...(run.usage ? { usage: record(run.usage) } : {}),
  };
}

export function parseExternalRunList(value: unknown): ExternalRunList {
  const result = record(value);
  if (!Array.isArray(result.items) || result.items.length > 200) throw new Error('Invalid monitoring response');
  return {
    items: result.items.map(parseExternalRun),
    ...(result.nextCursor ? { nextCursor: text(result.nextCursor, 500) } : {}),
  };
}

export function parseExternalTranscript(value: unknown): ExternalTranscript {
  const result = record(value);
  if (!Array.isArray(result.messages) || !Array.isArray(result.events)
    || result.messages.length > 2000 || result.events.length > 5000) throw new Error('Invalid monitoring response');
  return {
    run: parseExternalRun(result.run),
    messages: result.messages.map((value) => {
      const message = record(value);
      if (message.role !== 'user' && message.role !== 'assistant') throw new Error('Invalid monitoring response');
      return { role: message.role, content: text(message.content), createdAt: timestamp(message.createdAt) };
    }),
    events: result.events.map((value) => {
      const event = record(value);
      if (!Number.isSafeInteger(event.seq) || (event.seq as number) < 0) throw new Error('Invalid monitoring response');
      return { seq: event.seq as number, type: text(event.type, 100), data: event.data ?? null, createdAt: timestamp(event.createdAt) };
    }),
  };
}
