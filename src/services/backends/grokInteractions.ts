import type { StreamEvent, ToolQuestion } from '../../types';
import { GrokAcpClient, grokRecord, type GrokRpcMessage } from './grokProtocol';

interface PendingInteraction {
  message: GrokRpcMessage;
  questions: ToolQuestion[];
  answers: Record<string, string[]>;
  index: number;
}

/** Keep reverse RPC IDs until the corresponding user decision arrives. */
export class GrokInteractions {
  private pending: PendingInteraction[] = [];
  constructor(private client: GrokAcpClient, private emit: (event: StreamEvent) => void, private allowTools: boolean) {}

  handle(message: GrokRpcMessage): void {
    if (message.id === undefined) return;
    const params = message.params || {};
    if (!this.allowTools) {
      this.client.reject(message.id, 'Tools and interactions are disabled for this call');
      this.client.close(new Error('Grok requested a tool in a restricted call'));
      return;
    }
    if (message.method === 'session/request_permission') {
      const options = Array.isArray(params.options) ? params.options.map(grokRecord) : [];
      const allow = options.find(option => option.kind === 'allow_once');
      this.client.respond(message.id, { outcome: allow ? { outcome: 'selected', optionId: allow.optionId } : { outcome: 'cancelled' } });
      return;
    }
    if (message.method !== '_x.ai/ask_user_question' && message.method !== '_x.ai/exit_plan_mode') {
      this.client.reject(message.id, 'Unsupported Grok client request');
      return;
    }
    const questions = Array.isArray(params.questions) ? params.questions.map(grokRecord).flatMap(question => {
      if (typeof question.question !== 'string') return [];
      const options = Array.isArray(question.options) ? question.options.map(grokRecord).flatMap(option =>
        typeof option.label === 'string' ? [{ label: option.label, ...(typeof option.description === 'string' ? { description: option.description } : {}) }] : []) : [];
      return [{ question: question.question, options }];
    }) : [];
    this.pending.push({ message, questions, answers: {}, index: 0 });
    if (this.pending.length === 1) this.present();
  }

  input(text: string): boolean {
    const current = this.pending[0];
    if (!current) return false;
    const { message } = current;
    if (message.method === '_x.ai/exit_plan_mode') {
      const accepted = /^(yes|approve|approved|continue|run)$/i.test(text.trim());
      const abandoned = /^(abandon|cancel)$/i.test(text.trim());
      this.client.respond(message.id!, accepted ? { outcome: 'approved' }
        : abandoned ? { outcome: 'abandoned' } : { outcome: 'cancelled', feedback: text });
    } else if (/^(cancel|skip)$/i.test(text.trim())) {
      this.client.respond(message.id!, { outcome: 'cancelled' });
    } else {
      const question = current.questions[current.index];
      if (question) current.answers[question.question] = [text];
      current.index += 1;
      if (current.index < current.questions.length) { this.present(); return true; }
      this.client.respond(message.id!, { outcome: 'accepted', answers: current.answers });
    }
    this.finish();
    return true;
  }

  cancel(): void {
    for (const pending of this.pending) this.client.respond(pending.message.id!, { outcome: 'cancelled' });
    this.pending = [];
  }

  resolved(id: unknown): void {
    const index = this.pending.findIndex(pending => pending.message.id === id || pending.message.params?.toolCallId === id);
    if (index < 0) return;
    this.pending.splice(index, 1);
    if (index === 0) this.present();
  }

  private finish(): void {
    const current = this.pending.shift()!;
    const params = current.message.params || {};
    this.emit({ type: 'tool_outcomes', outcomes: [{ toolUseId: String(params.toolCallId || current.message.id), isError: false, outcome: 'answered', status: 'success' }] });
    this.present();
  }

  private present(): void {
    const current = this.pending[0];
    if (!current) return;
    const params = current.message.params || {};
    const id = String(params.toolCallId || current.message.id);
    if (current.message.method === '_x.ai/exit_plan_mode') {
      // Each reverse request is a new decision, including revisions without a native mode-change notification.
      this.emit({ type: 'tool_activity', tool: 'EnterPlanMode', id: null, description: 'Preparing plan approval', isPlanMode: true, planAction: 'enter' });
      this.emit({ type: 'tool_activity', tool: 'ExitPlanMode', id, description: 'Plan ready for approval', isPlanMode: true, planAction: 'exit',
        planContent: typeof params.planContent === 'string' ? params.planContent : '' });
    } else {
      this.emit({ type: 'tool_activity', tool: 'AskUserQuestion', id, description: 'Asking a question', isQuestion: true, questions: current.questions.slice(current.index, current.index + 1) });
    }
  }
}
