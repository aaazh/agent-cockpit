import crypto from 'crypto';
import fsp from 'fs/promises';
import os from 'os';
import path from 'path';
import type { BackendMetadata, Message, SendMessageOptions, SendMessageResult, StreamEvent, ThreadGoal } from '../../types';
import { BaseBackendAdapter, type BackendCallOptions, type RunOneShotOptions } from './base';
import { GrokAcpClient, GrokRpcError, GrokStreamQueue, grokRecord, type GrokRecord } from './grokProtocol';
import { resolveGrokCliRuntime, startGrokRuntime, type GrokRuntime } from './grokRuntime';
import { grokModelsFromInitialize } from './grokModels';
import { GrokEventDecoder } from './grokEvents';
import { GrokInteractions } from './grokInteractions';
import { grokUsageDelta, grokUsageEvents } from './grokUsage';
import { normalizeGrokGoal } from './grokGoals';
import { sanitizeSystemPrompt } from './toolUtils';
import { buildNativeSessionRecovery, buildSessionRecoveryEvent, createRecoverySnapshot } from './sessionRecovery';
import { logger } from '../../utils/logger';

export { resolveGrokCliRuntime } from './grokRuntime';

const NO_TOOLS = {
  name: 'cockpit-text', description: 'Text extraction without tools', discoverSkills: false, agentsMd: false,
  injectDefaultTools: false, toolConfig: { tools: [{ id: 'GrokBuild:read_file' }] }, disallowedTools: ['read_file'],
};
const log = logger.child({ module: 'grok-backend' });
interface Entry { runtime: GrokRuntime; fingerprint: string; mcpKey: string; instructions: string | null; idleTimer?: NodeJS.Timeout; preparing?: Promise<void> }
interface TurnState { aborted: boolean; finished: boolean; client: GrokAcpClient | null; runtime: GrokRuntime | null; interactions: GrokInteractions | null; decoder?: GrokEventDecoder; draining?: boolean; wake?: () => void }

export class GrokBuildAdapter extends BaseBackendAdapter {
  private entries = new Map<string, Promise<Entry>>();
  private clients = new Set<GrokAcpClient>();
  private models: NonNullable<BackendMetadata['models']> = [];

  constructor(options: { workingDir?: string } = {}) {
    super(options);
    this.workingDir = options.workingDir || path.join(os.homedir(), '.agent-cockpit', 'workspace');
  }

  get metadata(): BackendMetadata {
    return {
      id: 'grok-build', label: 'Grok Build',
      icon: '<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 28 28"><rect width="28" height="28" rx="7" fill="#171717"/><path d="M20 9a8 8 0 1 0 1 9v-5h-8v3h5v1a5 5 0 1 1 0-6z" fill="white"/></svg>',
      capabilities: {
        thinking: true, planMode: true, agents: true, toolActivity: true, userQuestions: true, stdinInput: true,
        goals: { set: true, clear: true, pause: true, resume: true, status: 'native' },
        oneShotMediaInput: { image: ['explicit-attachment', 'native-file-tool'], pdf: ['native-file-tool'] },
      },
      resumeCapabilities: {
        activeTurnResume: 'unsupported', activeTurnResumeReason: 'Grok can recover session history, but an interrupted active turn cannot safely be reattached or retried.',
        sessionResume: 'supported', sessionResumeReason: 'Grok native session IDs are persisted and resumed for later turns without replaying history into the answer.',
      }, models: this.models,
    };
  }

  async getMetadata(options: BackendCallOptions = {}): Promise<BackendMetadata> {
    const runtime = await startGrokRuntime(options.cliProfile, undefined, client => this.track(client));
    try {
      this.models = grokModelsFromInitialize(runtime.init);
      return { ...this.metadata, models: this.models };
    }
    finally { runtime.client.close(); this.clients.delete(runtime.client); }
  }

  sendMessage(message: string, options?: SendMessageOptions): SendMessageResult {
    if (!options) throw new Error('Grok send options are required');
    return this.turn(message, options);
  }

  setGoalObjective(objective: string, options?: SendMessageOptions): SendMessageResult {
    if (!options) throw new Error('Grok goal options are required');
    if (!objective.trim()) throw new Error('Goal objective is required');
    return this.turn(`/goal ${objective.trim()}`, options);
  }

  resumeGoal(options?: SendMessageOptions): SendMessageResult {
    if (!options) throw new Error('Grok goal options are required');
    return this.turn('/goal resume', options);
  }

  async getGoal(options: SendMessageOptions): Promise<ThreadGoal | null> {
    if (!this.entries.has(this.key(options)) && !options.externalSessionId) return null;
    const entry = await this.entry(options);
    if (!await this.attach(entry, options)) return null;
    const state = grokRecord(await entry.runtime.client.request('_x.ai/session/state', { sessionId: entry.runtime.sessionId, cwd: options.workingDir || this.workingDir! }));
    return normalizeGrokGoal(state.goal, entry.runtime.sessionId!);
  }

  async pauseGoal(options: SendMessageOptions): Promise<ThreadGoal | null> {
    const entry = await this.entry(options);
    if (entry.runtime.busy) {
      entry.runtime.cancel?.();
      await entry.runtime.busy;
    } else if (!await this.control('/goal pause', entry, options)) return null;
    const goal = await this.getGoal(options);
    if (goal && goal.status !== 'paused') throw new Error('Grok did not confirm that the goal was paused');
    return goal;
  }

  async clearGoal(options: SendMessageOptions): Promise<{ cleared: boolean; sessionId: string | null }> {
    const entry = await this.entry(options);
    if (entry.runtime.busy) {
      const goal = await this.getGoal(options);
      if (!goal || goal.status === 'active') throw new Error('Pause or stop the Grok turn before clearing its goal');
      await entry.runtime.busy;
    }
    await this.control('/goal clear', entry, options);
    return { cleared: true, sessionId: entry.runtime.sessionId };
  }

  /** Runs a native goal command on an existing session; returns false when there is no native session to control. */
  private async control(command: string, entry: Entry, options: SendMessageOptions): Promise<boolean> {
    if (entry.runtime.busy) throw new Error('Grok already has an active turn for this conversation');
    let release!: () => void;
    // Reserve the runtime before awaiting so a turn cannot start while the session attaches.
    entry.runtime.busy = new Promise<void>(resolve => { release = resolve; });
    try {
      if (!await this.attach(entry, options)) return false;
      await entry.runtime.client.request('session/prompt', { sessionId: entry.runtime.sessionId, prompt: [{ type: 'text', text: command }] });
      return true;
    } finally {
      entry.runtime.busy = null;
      release();
    }
  }

  private turn(message: string, options: SendMessageOptions, oneShot?: RunOneShotOptions): SendMessageResult {
    const queue = new GrokStreamQueue<StreamEvent>();
    const state: TurnState = { aborted: false, finished: false, client: null, runtime: null, interactions: null };
    let cancelTimer: NodeJS.Timeout | undefined;
    const abort = () => {
      if (state.aborted) return;
      state.aborted = true;
      state.interactions?.cancel();
      if (!state.client) return;
      if (state.runtime?.sessionId) state.client.notify('session/cancel', { sessionId: state.runtime.sessionId });
      else { state.client.close(new Error('Grok turn cancelled')); return; }
      for (const subagentId of state.decoder?.activeChildren.values() || []) {
        if (subagentId) void state.client.request('_x.ai/subagent/cancel', { subagentId }).catch(() => {});
      }
      if (state.draining) {
        state.client.close(new Error('Grok turn cancelled'));
        state.wake?.();
        return;
      }
      cancelTimer = setTimeout(() => state.client?.close(new Error('Grok cancellation timed out')), 5_000);
      cancelTimer.unref();
    };
    const sendInput = (text: string) => {
      if (state.aborted || !text.trim() || !state.client) return;
      if (state.interactions?.input(text)) return;
      if (!state.runtime?.sessionId) return;
      void state.client.request('_x.ai/interject', {
        sessionId: state.runtime.sessionId, text, interjectionId: crypto.randomUUID(),
      }).catch(error => queue.push({ type: 'error', terminal: false, source: 'backend', error: (error as Error).message }));
    };
    const run = () => this.runTurn(message, options, oneShot, state, queue, abort).finally(() => { if (cancelTimer) clearTimeout(cancelTimer); });
    // Start setup when the stream is consumed, as with the other adapters.
    async function* events(): AsyncGenerator<StreamEvent> {
      const worker = run();
      let complete = false;
      try { for await (const event of queue) yield event; await worker; complete = true; }
      finally { if (!complete) abort(); await worker; }
    }
    return { stream: events(), abort, sendInput };
  }

  private async runTurn(message: string, options: SendMessageOptions, oneShot: RunOneShotOptions | undefined,
    state: TurnState, queue: GrokStreamQueue<StreamEvent>, abort: () => void): Promise<void> {
    let entry: Entry | undefined;
    let unsubscribe: (() => void) | undefined;
    let timer: NodeJS.Timeout | undefined;
    let release: (() => void) | undefined;
    const allowTools = oneShot ? oneShot.allowTools === true : true;
    const timeoutMs = oneShot?.timeoutMs || 3_600_000;
    let rejectDeadline!: (error: Error) => void;
    let timedOut = false;
    const deadline = new Promise<never>((_resolve, reject) => { rejectDeadline = reject; });
    const wait = <T>(operation: Promise<T>): Promise<T> => Promise.race([operation, deadline]);
    const armTimeout = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timedOut = true;
        const error = new Error(`Grok turn timed out after ${timeoutMs}ms`);
        state.client?.close(error);
        rejectDeadline(error);
      }, timeoutMs);
    };
    const abortSignal = oneShot?.abortSignal;
    abortSignal?.addEventListener('abort', abort, { once: true });
    try {
      if (state.aborted || abortSignal?.aborted) throw new Error('Grok turn cancelled');
      armTimeout();
      entry = await wait(this.entry(options, client => { state.client = client; if (state.aborted || state.finished) client.close(); }));
      if (state.aborted) throw new Error('Grok turn cancelled');
      const runtime = entry.runtime;
      if (runtime.busy) throw new Error('Grok already has an active turn for this conversation');
      runtime.busy = new Promise<void>(resolve => { release = resolve; });
      runtime.cancel = abort;
      state.client = runtime.client;
      state.runtime = runtime;
      if (entry.idleTimer) clearTimeout(entry.idleTimer);
      const instructions = sanitizeSystemPrompt(options.systemPrompt);
      const nativeControl = allowTools && /^\/goal(?:\s|$)/.test(message);
      let decoder: GrokEventDecoder | null = null;
      const interactions = new GrokInteractions(runtime.client, event => queue.push(event), allowTools);
      state.interactions = interactions;
      unsubscribe = runtime.client.subscribe(notification => {
        if (!oneShot) armTimeout();
        if (notification.id !== undefined) { interactions.handle(notification); return; }
        const update = grokRecord(notification.params?.update);
        if (update.sessionUpdate === 'interaction_resolved') interactions.resolved(update.tool_call_id ?? update.toolCallId ?? update.request_id ?? update.requestId);
        if (!allowTools && update.sessionUpdate === 'tool_call') {
          runtime.client.close(new Error('Grok exposed a tool in a restricted call')); return;
        }
        if (!decoder) return; // Session load/recovery notifications are historical.
        for (const event of decoder.decode(notification)) queue.push(event);
        state.wake?.();
        state.wake = undefined;
      });
      const prepared = await wait(this.prepare(entry, options, event => queue.push(event), !allowTools, message !== '/goal resume'));
      // Announce every turn: a goal status read may have attached this session without persisting it.
      queue.push({ type: 'external_session', sessionId: runtime.sessionId! });
      queue.push({ type: 'backend_runtime', externalSessionId: runtime.sessionId!, processId: runtime.client.process.pid });
      if (!allowTools) {
        const info = grokRecord(grokRecord(await wait(runtime.client.request('_x.ai/session/info', { sessionId: runtime.sessionId }))).result);
        if (grokRecord(info.context).toolDefinitionsCount !== 0) {
          runtime.client.close(new Error('Grok could not verify a tool-free session'));
          throw new Error('Grok could not verify a tool-free session');
        }
      }
      // Prevent native slash-command dispatch from bypassing the no-tool profile.
      let prompt = allowTools ? message : `Complete this request with a text response only:\n\n${message}`;
      if (prepared.recoveryPrompt && !nativeControl) prompt = `${prepared.recoveryPrompt}\n\n${prompt}`;
      // Slash commands must remain the entire native control prompt.
      if (entry.instructions !== instructions && !nativeControl) {
        if (instructions) prompt = `[Agent Cockpit instructions]\n${instructions}\n[/Agent Cockpit instructions]\n\n${prompt}`;
        entry.instructions = instructions;
      }
      decoder = new GrokEventDecoder(runtime.sessionId!);
      state.decoder = decoder;
      const blocks: GrokRecord[] = [{ type: 'text', text: prompt }];
      for (const attachment of oneShot?.attachments || []) {
        const model = options.model || String(grokRecord(grokRecord(runtime.init._meta).modelState).currentModelId || '');
        if (model !== 'grok-4.7') throw new Error(`Media transport has not been verified for Grok model ${model}`);
        if (attachment.kind === 'image') {
          const mimeType = attachment.mimeType || imageMime(attachment.path);
          if (!['image/png', 'image/jpeg', 'image/webp'].includes(mimeType)) throw new Error(`Grok image transport has not been verified for ${mimeType}`);
          blocks.push({ type: 'image', mimeType, data: (await wait(fsp.readFile(attachment.path))).toString('base64') });
        } else if (attachment.kind === 'pdf' && allowTools) {
          blocks.push({ type: 'text', text: `Read the attached PDF with your native file tool: ${path.resolve(attachment.path)}` });
        } else throw new Error(`Grok ${attachment.kind} attachment requires a verified media transport`);
      }
      let beforeUsage: unknown;
      try { beforeUsage = grokRecord(await wait(runtime.client.request('_x.ai/session/usage', { sessionId: runtime.sessionId }, 5_000))).usage; }
      catch (error) { if (timedOut) throw error; }
      const response = grokRecord(await wait(runtime.client.request('session/prompt', { sessionId: runtime.sessionId, prompt: blocks }, 0)));
      if (state.aborted && decoder.activeChildren.size > 0) {
        runtime.client.close(new Error('Grok turn cancelled'));
        throw new Error('Grok turn cancelled');
      }
      if (oneShot && (state.aborted || response.stopReason === 'cancelled')) throw new Error('Grok one-shot cancelled');
      if (oneShot && response.stopReason !== 'end_turn') throw new Error(`Grok one-shot stopped before completion: ${String(response.stopReason)}`);
      let usage = grokRecord(response._meta).usage;
      if (!state.aborted && (decoder.activeChildren.size > 0 || decoder.awaitingParentWake)) {
        state.draining = true;
        const originalText = decoder.finalText;
        if (originalText.trim()) queue.push({ type: 'turn_boundary' });
        decoder.finalText = '';
        while (!state.aborted && (decoder.activeChildren.size > 0 || decoder.awaitingParentWake)) {
          await wait(Promise.race([new Promise<void>(resolve => { state.wake = resolve; }), runtime.client.closed]));
        }
        if (state.aborted) throw new Error('Grok turn cancelled');
        if (!decoder.finalText) decoder.finalText = originalText;
        try {
          const after = grokRecord(await wait(runtime.client.request('_x.ai/session/usage', { sessionId: runtime.sessionId }, 5_000))).usage;
          const reconciled = beforeUsage && after ? grokUsageDelta(beforeUsage, after) : null;
          if (reconciled) usage = reconciled;
          else queue.push({ type: 'error', terminal: false, error: 'Grok background usage could not be reconciled.' });
        } catch (error) {
          if (timedOut) throw error;
          queue.push({ type: 'error', terminal: false, error: 'Grok background usage is unavailable.' });
        }
        state.draining = false;
      }
      let contextPercentage: number | undefined;
      if (!oneShot) {
        try {
          const info = grokRecord(grokRecord(await wait(runtime.client.request('_x.ai/session/info', { sessionId: runtime.sessionId }, 5_000))).result);
          const context = grokRecord(info.context);
          if (typeof context.usagePct === 'number') contextPercentage = context.usagePct;
        } catch (error) { if (timedOut) throw error; /* optional context snapshot */ }
      }
      if (usage) {
        for (const event of grokUsageEvents(usage, contextPercentage, options.model)) queue.push(event);
      }
      queue.push({ type: 'result', content: decoder.finalText });
    } catch (error) {
      queue.push({ type: 'error', error: (error as Error).message, source: state.aborted ? 'abort' : 'backend' });
      if (entry && release) entry.runtime.client.close(error as Error);
      if (entry && state.client?.isClosed) this.entries.delete(this.key(options));
    } finally {
      if (timer) clearTimeout(timer);
      abortSignal?.removeEventListener('abort', abort);
      unsubscribe?.();
      state.interactions?.cancel();
      if (entry && release) {
        entry.runtime.busy = null;
        entry.runtime.cancel = null;
        release();
        if (!oneShot && !entry.runtime.client.isClosed) {
          const key = this.key(options);
          const current = this.entries.get(key);
          entry.idleTimer = setTimeout(() => { entry!.runtime.client.close(); if (this.entries.get(key) === current) this.entries.delete(key); }, 3_600_000);
          entry.idleTimer.unref();
        }
      }
      state.runtime = null;
      state.client = null;
      state.finished = true;
      queue.push({ type: 'done' });
      queue.end();
    }
  }

  private key(options: SendMessageOptions): string { return options.conversationId || options.sessionId; }

  private async entry(options: SendMessageOptions, onClient?: (client: GrokAcpClient) => void): Promise<Entry> {
    const key = this.key(options);
    const cwd = options.workingDir || this.workingDir!;
    const fingerprint = `${resolveGrokCliRuntime(options.cliProfile).profileKey}:${cwd}`;
    const cached = this.entries.get(key);
    if (cached) {
      const entry = await cached;
      if (!entry.runtime.client.isClosed && entry.fingerprint === fingerprint) return entry;
      if (entry.runtime.busy) throw new Error('Cannot change a Grok runtime while a turn is active');
      if (entry.idleTimer) clearTimeout(entry.idleTimer);
      entry.runtime.client.close();
      this.entries.delete(key);
    }
    const creating = (async () => {
      if (options.workingDir) {
        const directory = await fsp.stat(cwd).catch(() => null);
        if (!directory?.isDirectory()) throw new Error(`Grok working directory is unavailable: ${cwd}`);
      } else await fsp.mkdir(cwd, { recursive: true });
      const runtime = await startGrokRuntime(options.cliProfile, cwd, client => {
        this.track(client);
        onClient?.(client);
        if (this.entries.get(key) !== creating) client.close();
      });
      this.models = grokModelsFromInitialize(runtime.init);
      return { runtime, fingerprint, mcpKey: '', instructions: null };
    })();
    this.entries.set(key, creating);
    try {
      const entry: Entry = await creating;
      entry.idleTimer = setTimeout(() => {
        entry.runtime.client.close();
        if (this.entries.get(key) === creating) this.entries.delete(key);
      }, 3_600_000);
      entry.idleTimer.unref();
      return entry;
    }
    catch (error) { if (this.entries.get(key) === creating) this.entries.delete(key); throw error; }
  }

  private prepare(entry: Entry, options: SendMessageOptions, emit: (event: StreamEvent) => void, noTools: boolean, recoverMissing: boolean): Promise<{ recoveryPrompt?: string }> {
    return this.serialize(entry, () => this.prepareSession(entry, options, emit, noTools, recoverMissing));
  }

  /** Goal status and control attach an existing native session without creating, recovering, or reconfiguring one. */
  private async attach(entry: Entry, options: SendMessageOptions): Promise<boolean> {
    try {
      await this.serialize(entry, async () => {
        if (!entry.runtime.sessionId && options.externalSessionId) await this.prepareSession(entry, options, () => {}, false, false);
      });
    } catch (error) {
      if (isMissingGrokSession(error)) return false;
      throw error;
    }
    return Boolean(entry.runtime.sessionId);
  }

  /** Session setup runs one caller at a time, so no caller inherits another caller's recovery or event handling. */
  private serialize<T>(entry: Entry, work: () => Promise<T>): Promise<T> {
    const run = (entry.preparing || Promise.resolve()).then(work);
    const settled = run.then(() => {}, () => {});
    entry.preparing = settled;
    void settled.then(() => { if (entry.preparing === settled) entry.preparing = undefined; });
    return run;
  }

  private async prepareSession(entry: Entry, options: SendMessageOptions, emit: (event: StreamEvent) => void, noTools: boolean, recoverMissing: boolean): Promise<{ recoveryPrompt?: string }> {
    const { runtime } = entry;
    const cwd = options.workingDir || this.workingDir!;
    const mcpServers = noTools ? [] : options.mcpServers || [];
    const mcpKey = JSON.stringify(mcpServers);
    const caps = grokRecord(grokRecord(runtime.init.agentCapabilities).sessionCapabilities);
    const attachMethod = caps.resume !== undefined ? 'session/resume' : 'session/load';
    let recoveryPrompt: string | undefined;
    if (!runtime.sessionId) {
      const meta = { rules: sanitizeSystemPrompt(options.systemPrompt), ...(noTools ? { agentProfile: NO_TOOLS } : {}) };
      if (options.externalSessionId) {
        try {
          await runtime.client.request(attachMethod, {
            sessionId: options.externalSessionId, cwd, mcpServers, _meta: meta,
          });
          runtime.sessionId = options.externalSessionId;
        } catch (error) {
          if (!recoverMissing || !isMissingGrokSession(error)) throw error;
          const snapshot = await createRecoverySnapshot(options, { previousNativeSessionId: options.externalSessionId, reason: 'missing_native_session' });
          const seed = buildNativeSessionRecovery({ backend: 'grok-build', previousNativeSessionId: options.externalSessionId,
            reason: 'missing_native_session', snapshot, currentPrompt: '' });
          const fresh = grokRecord(await runtime.client.request('session/new', { cwd, mcpServers,
            _meta: { ...meta, rules: `${meta.rules}\n\n${seed.prompt}` } }));
          if (typeof fresh.sessionId !== 'string') throw new Error('Grok did not return a native session ID');
          runtime.sessionId = fresh.sessionId;
          const recovery = buildNativeSessionRecovery({ backend: 'grok-build', previousNativeSessionId: options.externalSessionId,
            newNativeSessionId: runtime.sessionId, reason: 'missing_native_session', snapshot, currentPrompt: '' });
          recoveryPrompt = recovery.prompt;
          emit(buildSessionRecoveryEvent(recovery.metadata));
          entry.instructions = meta.rules;
        }
      } else {
        const fresh = grokRecord(await runtime.client.request('session/new', { cwd, mcpServers, _meta: meta }));
        if (typeof fresh.sessionId !== 'string') throw new Error('Grok did not return a native session ID');
        runtime.sessionId = fresh.sessionId;
        entry.instructions = meta.rules;
      }
      entry.mcpKey = mcpKey;
    } else if (entry.mcpKey !== mcpKey) {
      await runtime.client.request(attachMethod, { sessionId: runtime.sessionId, cwd, mcpServers });
      entry.mcpKey = mcpKey;
    }
    if (options.model) await runtime.client.request('session/set_model', { sessionId: runtime.sessionId, modelId: options.model });
    if (options.effort) await runtime.client.request('session/set_config_option', { sessionId: runtime.sessionId, configId: 'reasoning_effort', value: options.effort });
    return { recoveryPrompt };
  }

  async runOneShot(prompt: string, options: RunOneShotOptions = {}): Promise<string> {
    return (await this.runSessionShot([prompt], options))[0];
  }

  async runSessionShot(prompts: string[], options: RunOneShotOptions = {}): Promise<string[]> {
    const key = `grok-one-shot-${crypto.randomUUID()}`;
    const outputs: string[] = [];
    const started = Date.now();
    let externalSessionId: string | undefined;
    try {
      for (const prompt of prompts) {
        const remaining = (options.timeoutMs || 60_000) - (Date.now() - started);
        if (remaining <= 0) throw new Error('Grok one-shot timed out');
        const result = this.turn(prompt, { sessionId: key, conversationId: key, isNewSession: !externalSessionId,
          externalSessionId, workingDir: options.workingDir || this.workingDir, systemPrompt: '', cliProfile: options.cliProfile,
          model: options.model, effort: options.effort, mcpServers: options.allowTools ? options.mcpServers : [] },
        { ...options, timeoutMs: remaining });
        let text = '';
        for await (const event of result.stream) {
          if (event.type === 'external_session') externalSessionId = event.sessionId;
          if (event.type === 'result') text = event.content;
          if (event.type === 'error' && event.terminal !== false) throw new Error(event.error);
        }
        outputs.push(text.trim());
      }
      return outputs;
    } finally { this.onSessionReset(key); }
  }

  async generateTitle(message: string, fallback: string, options: BackendCallOptions = {}): Promise<string> {
    try {
      const title = (await this.runOneShot(`Return only a short chat title for this request:\n${message.slice(0, 4_000)}`, { ...options, timeoutMs: 30_000 })).trim().replace(/^['"]|['"]$/g, '').replace(/\n/g, ' ');
      return title.slice(0, 80) || fallback;
    } catch (error) { log.debug('Grok title generation failed', { error }); return fallback; }
  }

  async generateSummary(messages: Pick<Message, 'role' | 'content'>[], fallback: string, options: BackendCallOptions = {}): Promise<string> {
    try {
      return (await this.runOneShot(`Summarize this conversation in one concise sentence. Return only the summary.\n${JSON.stringify(messages).slice(0, 24_000)}`, { ...options, timeoutMs: 30_000 })).trim() || fallback;
    } catch (error) { log.debug('Grok summary generation failed', { error }); return fallback; }
  }

  onSessionReset(conversationId: string): void {
    const entry = this.entries.get(conversationId);
    this.entries.delete(conversationId);
    void entry?.then(value => { if (value.idleTimer) clearTimeout(value.idleTimer); value.runtime.client.close(); this.clients.delete(value.runtime.client); }).catch(() => {});
  }

  shutdown(): void {
    for (const key of this.entries.keys()) this.onSessionReset(key);
    for (const client of this.clients) client.close();
    this.clients.clear();
  }

  private track(client: GrokAcpClient): void {
    this.clients.add(client);
    const remove = () => this.clients.delete(client);
    client.process.once?.('exit', remove);
    client.process.once?.('error', remove);
  }
}

function imageMime(filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  return ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : ext === '.webp' ? 'image/webp' : ext === '.png' ? 'image/png' : 'unknown';
}

function isMissingGrokSession(error: unknown): error is GrokRpcError {
  return error instanceof GrokRpcError && error.code === -32603 && grokRecord(error.data).code === 'FS_NOT_FOUND';
}
