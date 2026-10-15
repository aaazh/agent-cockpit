import type { StreamEvent } from '../../types';
import { grokRecord, type GrokRpcMessage } from './grokProtocol';
import { normalizeGrokGoal } from './grokGoals';
import { extractToolOutcome } from './toolUtils';

const TOOL_NAMES: Record<string, string> = {
  read_file: 'Read', write: 'Write', search_replace: 'Edit', run_terminal_command: 'Bash',
  grep: 'Grep', list_dir: 'Glob', todo_write: 'TodoWrite', web_search: 'WebSearch', web_fetch: 'WebFetch',
  enter_plan_mode: 'EnterPlanMode', exit_plan_mode: 'ExitPlanMode', ask_user_question: 'AskUserQuestion', spawn_subagent: 'SpawnAgent',
};

export class GrokEventDecoder {
  finalText = '';
  contextPercentage: number | undefined;
  readonly activeChildren = new Map<string, string | null>();
  awaitingParentWake = false;
  rootCompletions = 0;
  private children = new Set<string>();
  private tools = new Map<string, string>();
  private finished = new Set<string>();
  private artifacts = new Set<string>();
  private childText = new Map<string, string>();
  private childThinking = new Map<string, string>();

  constructor(readonly sessionId: string) {}

  decode(message: GrokRpcMessage): StreamEvent[] {
    if (!['session/update', '_x.ai/session_notification', '_x.ai/session/update'].includes(message.method || '')) return [];
    const params = message.params || {};
    const update = grokRecord(params.update);
    const kind = update.sessionUpdate;
    const incoming = typeof params.sessionId === 'string' ? params.sessionId : '';
    if (kind === 'subagent_spawned' && update.parent_session_id === this.sessionId && typeof update.child_session_id === 'string') {
      const id = update.child_session_id;
      if (this.children.has(id)) return [];
      this.children.add(id);
      this.activeChildren.set(id, typeof update.subagent_id === 'string' ? update.subagent_id : null);
      return [{ type: 'tool_activity', tool: 'Agent', id, isAgent: true,
        subagentType: String(update.subagent_type || 'general-purpose'), description: String(update.description || 'Running subagent') }];
    }
    if (kind === 'subagent_finished' && typeof update.child_session_id === 'string' && this.children.has(update.child_session_id)) {
      const id = update.child_session_id;
      if (this.finished.has(`child:${id}`)) return [];
      this.finished.add(`child:${id}`);
      this.activeChildren.delete(id);
      if (update.will_wake === true) this.awaitingParentWake = true;
      const output = typeof update.output === 'string' ? update.output : this.childText.get(id) || update.status;
      const thinking = this.childThinking.get(id);
      this.childThinking.delete(id);
      const status = update.status === 'failed' ? 'error' : update.status === 'cancelled' ? 'warning' : 'success';
      return [{ type: 'tool_outcomes', outcomes: [
        { toolUseId: id, isError: update.status === 'failed', outcome: String(output || ''), status },
        ...(thinking !== undefined ? [{ toolUseId: `${id}:thinking`, isError: update.status === 'failed', outcome: thinking, status }] : []),
      ] }];
    }
    const parentAgentId = this.children.has(incoming) ? incoming : undefined;
    if (incoming !== this.sessionId && !parentAgentId) return [];
    if (kind === 'turn_completed' && !parentAgentId) {
      this.rootCompletions += 1;
      this.awaitingParentWake = false;
      return [];
    }
    if (kind === 'agent_message_chunk' || kind === 'agent_thought_chunk') {
      const content = grokRecord(update.content).text;
      if (typeof content !== 'string') return [];
      if (parentAgentId) {
        if (kind === 'agent_message_chunk') this.childText.set(incoming, (this.childText.get(incoming) || '') + content);
        if (kind !== 'agent_thought_chunk' || !content) return [];
        const first = !this.childThinking.has(incoming);
        this.childThinking.set(incoming, ((this.childThinking.get(incoming) || '') + content).slice(0, 500));
        return first ? [{ type: 'tool_activity', tool: 'Thinking', id: `${incoming}:thinking`, parentAgentId, description: 'Thinking' }] : [];
      }
      if (kind === 'agent_message_chunk') this.finalText += content;
      return [{ type: kind === 'agent_message_chunk' ? 'text' : 'thinking', content, streaming: true }];
    }
    if (kind === 'goal_updated' && !parentAgentId) {
      const goal = normalizeGrokGoal(update, this.sessionId);
      return goal ? [{ type: 'goal_updated', goal }] : [{ type: 'goal_cleared', threadId: this.sessionId }];
    }
    if (kind === 'current_mode_update' && !parentAgentId) {
      return [{ type: 'tool_activity', tool: update.currentModeId === 'plan' ? 'EnterPlanMode' : 'Mode', id: null,
        description: `Mode: ${String(update.currentModeId || 'default')}`, isPlanMode: update.currentModeId === 'plan',
        ...(update.currentModeId === 'plan' ? { planAction: 'enter' as const } : {}) }];
    }
    if (kind !== 'tool_call' && kind !== 'tool_call_update') return [];
    if (typeof update.toolCallId !== 'string') return [];
    const id = update.toolCallId;
    const meta = grokRecord(grokRecord(update._meta)['x.ai/tool']);
    const input = grokRecord(update.rawInput);
    const nativeName = meta.name === 'use_tool' && typeof input.tool_name === 'string' ? input.tool_name
      : String(meta.name || update.title || this.tools.get(id) || 'Tool');
    const tool = TOOL_NAMES[nativeName] || nativeName;
    const events: StreamEvent[] = [];
    if (kind === 'tool_call') {
      if (!parentAgentId) {
        if (this.finalText.trim()) events.push({ type: 'turn_boundary' });
        this.finalText = '';
      }
      this.tools.set(id, tool);
      // Interactive callbacks carry the actual plan/questions, so do not open an empty card here.
      events.push({ type: 'tool_activity', id, tool, description: meta.name === 'use_tool' ? `Using ${tool}` : String(update.title || tool), ...(parentAgentId ? { parentAgentId } : {}) });
    }
    const output = grokRecord(update.rawOutput);
    if (output.type === 'ImageGen' && typeof output.path === 'string' && !this.artifacts.has(output.path)) {
      this.artifacts.add(output.path);
      events.push({ type: 'artifact', sourcePath: output.path, filename: typeof output.filename === 'string' ? output.filename : undefined, sourceToolId: id });
    }
    if ((update.status === 'completed' || update.status === 'failed') && !this.finished.has(id)) {
      this.finished.add(id);
      const outcome = extractToolOutcome(this.tools.get(id) || tool, update.rawOutput);
      events.push({ type: 'tool_outcomes', outcomes: [{ toolUseId: id, isError: update.status === 'failed' || outcome?.status === 'error',
        outcome: outcome?.outcome || String(update.status), status: update.status === 'failed' ? 'error' : outcome?.status || 'success' }] });
    }
    return events;
  }
}
