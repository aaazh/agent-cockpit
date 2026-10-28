import { parseExternalRunList, parseExternalTranscript, type ExternalRunList, type ExternalTranscript } from '../contracts/externalSessions';

export interface ExternalSessionSource {
  listRuns(cursor?: string): Promise<ExternalRunList>;
  getTranscript(id: string): Promise<ExternalTranscript>;
}

const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

/** Fixed administrative upstream; callers cannot choose hosts, paths or headers. */
export class HttpExternalSessionSource implements ExternalSessionSource {
  private readonly baseUrl: URL;

  constructor(url: string, private readonly token: string) {
    this.baseUrl = new URL(url);
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(this.baseUrl.hostname);
    if ((this.baseUrl.protocol !== 'https:' && !(local && this.baseUrl.protocol === 'http:'))
      || this.baseUrl.username || this.baseUrl.password || this.baseUrl.search || this.baseUrl.hash
      || this.baseUrl.pathname !== '/' || !token || /[\r\n]/.test(token)) {
      throw new Error('External session source requires a root HTTPS URL (or loopback HTTP) and a Bearer token');
    }
  }

  async listRuns(cursor?: string): Promise<ExternalRunList> {
    const url = new URL('/internal/monitoring/runs', this.baseUrl);
    if (cursor) url.searchParams.set('cursor', cursor);
    return parseExternalRunList(await this.read(url));
  }

  async getTranscript(id: string): Promise<ExternalTranscript> {
    if (!/^[a-zA-Z0-9_-]{1,200}$/.test(id)) throw new Error('Invalid run id');
    const result = parseExternalTranscript(await this.read(new URL(`/internal/monitoring/runs/${encodeURIComponent(id)}/transcript`, this.baseUrl)));
    if (result.run.id !== id) throw new Error('Invalid monitoring response');
    return result;
  }

  private async read(url: URL): Promise<unknown> {
    const response = await fetch(url, {
      method: 'GET',
      headers: { authorization: `Bearer ${this.token}`, accept: 'application/json' },
      redirect: 'error',
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok || !response.body) {
      await response.body?.cancel();
      throw new Error('Monitoring source unavailable');
    }
    const reader = response.body.getReader();
    let size = 0;
    const chunks: Uint8Array[] = [];
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        size += chunk.value.byteLength;
        if (size > MAX_RESPONSE_BYTES) throw new Error('Monitoring response too large');
        chunks.push(chunk.value);
      }
    } finally {
      await reader.cancel();
      reader.releaseLock();
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  }
}
