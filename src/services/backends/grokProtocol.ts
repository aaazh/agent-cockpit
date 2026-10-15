import type { ChildProcess } from 'child_process';
import { StringDecoder } from 'string_decoder';

export type GrokRecord = Record<string, unknown>;
export interface GrokRpcMessage {
  jsonrpc?: string;
  id?: string | number;
  method?: string;
  params?: GrokRecord;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

export function grokRecord(value: unknown): GrokRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as GrokRecord : {};
}

export class GrokRpcError extends Error {
  constructor(message: string, readonly code: number, readonly data?: unknown) {
    super(message);
  }
}

/** Grok's newline JSON-RPC transport; reverse requests have their own ID space. */
export class GrokAcpClient {
  readonly closed: Promise<never>;
  private rejectClosed!: (error: Error) => void;
  private nextId = 1;
  private pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void; timer?: NodeJS.Timeout }>();
  private listeners = new Set<(message: GrokRpcMessage) => void>();
  private decoder = new StringDecoder('utf8');
  private buffer = '';
  private failure: Error | null = null;

  constructor(readonly process: ChildProcess, private readonly cleanup: () => void) {
    this.closed = new Promise<never>((_resolve, reject) => { this.rejectClosed = reject; });
    void this.closed.catch(() => {}); // Metadata/auth callers need not subscribe to process death.
    process.stdout?.on('data', (chunk: Buffer) => this.read(chunk));
    process.stdin?.on('error', error => this.close(error));
    process.on('error', error => this.close(error));
    // exit fires even if an orphan still holds stdout open; close alone can hang.
    process.on('exit', () => this.close(new Error('Grok ACP process exited')));
  }

  get isClosed(): boolean { return this.failure !== null; }

  subscribe(listener: (message: GrokRpcMessage) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  request(method: string, params: GrokRecord = {}, timeoutMs = 45_000): Promise<unknown> {
    if (this.failure) return Promise.reject(this.failure);
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = timeoutMs > 0 ? setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Grok ${method} timed out`));
      }, timeoutMs) : undefined;
      this.pending.set(id, { resolve, reject, timer });
      this.write({ jsonrpc: '2.0', id, method, params });
    });
  }

  notify(method: string, params: GrokRecord): void {
    this.write({ jsonrpc: '2.0', method, params });
  }

  respond(id: string | number, result: unknown): void {
    this.write({ jsonrpc: '2.0', id, result });
  }

  reject(id: string | number, message: string): void {
    this.write({ jsonrpc: '2.0', id, error: { code: -32601, message } });
  }

  close(error = new Error('Grok ACP runtime stopped')): void {
    if (this.failure) return;
    this.failure = error;
    this.rejectClosed(error);
    for (const entry of this.pending.values()) {
      if (entry.timer) clearTimeout(entry.timer);
      entry.reject(error);
    }
    this.pending.clear();
    this.listeners.clear();
    this.cleanup();
  }

  private write(message: GrokRpcMessage): void {
    if (this.failure) return;
    this.process.stdin?.write(`${JSON.stringify(message)}\n`, error => { if (error) this.close(error); });
  }

  private read(chunk: Buffer): void {
    if (this.failure) return;
    this.buffer += this.decoder.write(chunk);
    let newline: number;
    while ((newline = this.buffer.indexOf('\n')) !== -1) {
      const line = this.buffer.slice(0, newline);
      this.buffer = this.buffer.slice(newline + 1);
      if (Buffer.byteLength(line) > 32 * 1024 * 1024) { this.close(new Error('Grok ACP frame exceeded 32 MiB')); return; }
      if (!line.trim()) continue;
      let message: GrokRpcMessage;
      try {
        message = JSON.parse(line) as GrokRpcMessage;
        if (!message || typeof message !== 'object' || Array.isArray(message)) throw new Error('Invalid frame');
      } catch { this.close(new Error('Malformed Grok ACP frame')); return; }
      if (typeof message.method === 'string') {
        for (const listener of this.listeners) listener(message);
        if (message.id !== undefined && this.listeners.size === 0) this.reject(message.id, 'No active Grok interaction');
      } else if (typeof message.id === 'number') {
        const entry = this.pending.get(message.id);
        if (!entry) continue;
        this.pending.delete(message.id);
        if (entry.timer) clearTimeout(entry.timer);
        if (message.error) entry.reject(new GrokRpcError(message.error.message, message.error.code, message.error.data));
        else entry.resolve(message.result);
      }
    }
    if (Buffer.byteLength(this.buffer) > 32 * 1024 * 1024) this.close(new Error('Grok ACP frame exceeded 32 MiB'));
  }
}

export class GrokStreamQueue<T> implements AsyncIterable<T> {
  private items: T[] = [];
  private wake: (() => void) | null = null;
  private ended = false;
  push(value: T): void {
    if (this.ended) return;
    this.items.push(value);
    this.wake?.();
  }
  end(): void { this.ended = true; this.wake?.(); }
  async *[Symbol.asyncIterator](): AsyncGenerator<T> {
    while (!this.ended || this.items.length) {
      if (this.items.length) yield this.items.shift()!;
      else await new Promise<void>(resolve => { this.wake = resolve; });
    }
  }
}
