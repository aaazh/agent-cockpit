import crypto from 'crypto';
import os from 'os';
import path from 'path';
import { spawn, type ChildProcess } from 'child_process';
import type { CliProfile } from '../../types';
import { buildCliCommandInvocation, resolveCliCommandForRuntime, type CliCommandResolution } from '../cliCommandResolver';
import { GrokAcpClient, grokRecord, type GrokRecord } from './grokProtocol';
import { logger } from '../../utils/logger';
import { GrokProcessScope } from './grokProcess';

export interface GrokCliRuntime extends CliCommandResolution {
  env: NodeJS.ProcessEnv;
  configDir?: string;
  profileKey: string;
}

export function resolveGrokCliRuntime(profile?: CliProfile): GrokCliRuntime {
  if (profile && profile.harness !== 'grok-build') throw new Error(`CLI profile harness ${profile.harness} is not grok-build`);
  const command = profile?.command?.trim() || 'grok';
  const env: NodeJS.ProcessEnv = {
    ...process.env, ...profile?.env, GROK_DISABLE_AUTOUPDATER: '1', GROK_PROMPT_SUGGESTIONS: 'false',
    GROK_TURN_SUMMARY: '0', GROK_MEMORY: '0',
  };
  const configDir = profile?.configDir?.trim();
  if (configDir) env.GROK_HOME = path.resolve(configDir.replace(/^~(?=\/|\\|$)/, os.homedir()));
  // Auth isolation must not select binaries restored into an account home.
  const resolved = resolveCliCommandForRuntime('grok-build', command, { ...env, GROK_HOME: process.env.GROK_HOME });
  const profileKey = crypto.createHash('sha256').update(JSON.stringify({ ...resolved, env })).digest('hex');
  return { ...resolved, env, configDir: env.GROK_HOME, profileKey };
}

export interface GrokRuntime {
  client: GrokAcpClient;
  init: GrokRecord;
  sessionId: string | null;
  busy: Promise<void> | null;
  cancel: (() => void) | null;
  scope?: GrokProcessScope;
}

export async function startGrokRuntime(profile?: CliProfile, cwd = process.cwd(), onClient?: (client: GrokAcpClient) => void): Promise<GrokRuntime> {
  const runtime = resolveGrokCliRuntime(profile);
  const invocation = buildCliCommandInvocation(runtime, ['--no-auto-update', '--always-approve', 'agent', '--no-leader', 'stdio']);
  const proc = spawn(invocation.command, invocation.args, {
    cwd, env: runtime.env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, detached: process.platform !== 'win32',
  });
  const scope = new GrokProcessScope(proc);
  scope.watch();
  const client = new GrokAcpClient(proc, () => scope.stop());
  onClient?.(client);
  // Drain diagnostics without exposing auth, tool arguments, or account data.
  proc.stderr?.on('data', () => {});
  try {
    const init = grokRecord(await client.request('initialize', {
      protocolVersion: 1, clientInfo: { name: 'agent-cockpit', version: '1' },
      clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
    }));
    if (init.protocolVersion !== 1) throw new Error('Grok did not negotiate ACP version 1');
    const methods = Array.isArray(init.authMethods) ? init.authMethods.map(grokRecord) : [];
    // 1.0.52 accepts API-key auth even when initialize only advertises grok.com.
    const methodId = methods.some(method => method.id === 'cached_token') ? 'cached_token'
      : runtime.env.XAI_API_KEY || methods.some(method => method.id === 'xai.api_key') ? 'xai.api_key' : null;
    if (methodId) await client.request('authenticate', { methodId, _meta: { headless: true } });
    return { client, init, sessionId: null, busy: null, cancel: null, scope };
  } catch (error) {
    client.close();
    logger.debug('Grok runtime initialization failed', { error });
    throw error;
  }
}

export async function grokAuthenticationStatus(profile?: CliProfile): Promise<{ authenticated: boolean; error?: string }> {
  const runtime = await startGrokRuntime(profile);
  try {
    const result = grokRecord(await runtime.client.request('_x.ai/auth/check_subscription'));
    const value = grokRecord(result.meta).gate;
    const gate = grokRecord(value);
    return { authenticated: result.authenticated === true,
      ...(value != null ? { error: `Grok Build access is blocked: ${typeof gate.message === 'string' ? gate.message : 'The account does not have access.'}` } : {}) };
  } finally { runtime.client.close(); }
}

export async function checkGrokAuthentication(profile?: CliProfile): Promise<boolean> {
  const status = await grokAuthenticationStatus(profile);
  return status.authenticated && !status.error;
}
