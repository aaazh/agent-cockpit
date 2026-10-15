import { EventEmitter } from 'events';
import { PassThrough } from 'stream';
import type { ChildProcess } from 'child_process';
import { GrokAcpClient, GrokRpcError, type GrokRpcMessage } from '../src/services/backends/grokProtocol';

function fixture() {
  const process = Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough() });
  const cleanup = jest.fn();
  const client = new GrokAcpClient(process as unknown as ChildProcess, cleanup);
  const writes: GrokRpcMessage[] = [];
  process.stdin.on('data', chunk => writes.push(JSON.parse(chunk.toString())));
  return { process, cleanup, client, writes };
}

describe('Grok ACP transport', () => {
  test('keeps reverse request ID zero separate from outgoing correlation', async () => {
    const f = fixture();
    const seen: GrokRpcMessage[] = [];
    f.client.subscribe(message => { seen.push(message); f.client.respond(message.id!, { outcome: 'accepted' }); });
    const result = f.client.request('session/prompt');
    f.process.stdout.write('{"jsonrpc":"2.0","id":0,"method":"_x.ai/ask_user_question","params":{}}\n');
    f.process.stdout.write('{"jsonrpc":"2.0","id":1,"result":{"stopReason":"end_turn"}}\n');
    expect(await result).toEqual({ stopReason: 'end_turn' });
    expect(seen[0].id).toBe(0);
    expect(f.writes[1]).toMatchObject({ id: 0, result: { outcome: 'accepted' } });
    f.client.close();
  });

  test('decodes split UTF-8, large frames, and multiple messages in one read', () => {
    const f = fixture();
    const seen: GrokRpcMessage[] = [];
    f.client.subscribe(message => seen.push(message));
    const large = '🦅'.repeat(50_000);
    const frame = Buffer.from(`${JSON.stringify({ method: 'session/update', params: { text: large } })}\n${JSON.stringify({ method: 'other' })}\n`);
    for (let i = 0; i < frame.length; i += 137) f.process.stdout.write(frame.subarray(i, i + 137));
    expect(seen).toHaveLength(2);
    expect(seen[0].params?.text).toBe(large);
    f.client.close();
  });

  test('preserves RPC error details for narrow session recovery', async () => {
    const f = fixture();
    const result = f.client.request('session/resume');
    f.process.stdout.write('{"id":1,"error":{"code":-32603,"message":"Path not found.","data":{"code":"FS_NOT_FOUND"}}}\n');
    await expect(result).rejects.toMatchObject({ code: -32603, data: { code: 'FS_NOT_FOUND' } });
    f.client.close();
  });

  test('rejects requests and cleans up on exit even when stdout stays open', async () => {
    const f = fixture();
    const result = f.client.request('session/prompt', {}, 0);
    f.process.emit('exit', 1);
    await expect(result).rejects.toThrow('exited');
    expect(f.cleanup).toHaveBeenCalledTimes(1);
    await expect(f.client.request('session/new')).rejects.toThrow('exited');
    f.client.close();
    expect(f.cleanup).toHaveBeenCalledTimes(1);
  });

  test('malformed frames fail outstanding requests without echoing sensitive data', async () => {
    const f = fixture();
    const result = f.client.request('session/prompt');
    f.process.stdout.write('secret-not-json\n');
    await expect(result).rejects.toThrow('Malformed Grok ACP frame');
    expect(f.cleanup).toHaveBeenCalledTimes(1);
  });

  test('times out an RPC without correlating a late reply to the next request', async () => {
    const f = fixture();
    await expect(f.client.request('slow', {}, 5)).rejects.toThrow('timed out');
    const next = f.client.request('next');
    f.process.stdout.write('{"id":1,"result":"old"}\n{"id":2,"result":"new"}\n');
    expect(await next).toBe('new');
    f.client.close();
  });

  test('rejects unsupported reverse requests when no interaction owns them', () => {
    const f = fixture();
    f.process.stdout.write('{"id":0,"method":"terminal/create"}\n');
    expect(f.writes[0]).toMatchObject({ id: 0, error: { code: -32601 } });
    f.client.close();
  });
});

test('GrokRpcError is an ordinary error with protocol metadata', () => {
  expect(new GrokRpcError('missing', -32603).message).toBe('missing');
});
