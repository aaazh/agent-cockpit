import type { ThreadGoal, ThreadGoalStatus } from '../../types';
import { grokRecord } from './grokProtocol';

export function normalizeGrokGoal(value: unknown, sessionId: string): ThreadGoal | null {
  const goal = grokRecord(value);
  if (typeof goal.objective !== 'string' || !goal.objective.trim() || goal.status === 'cleared') return null;
  const status: ThreadGoalStatus = goal.status === 'active' ? 'active'
    : goal.status === 'complete' ? 'complete'
      : goal.status === 'budget_limited' ? 'budgetLimited'
        : goal.status === 'blocked' || typeof goal.status === 'string' && goal.status.endsWith('paused') ? 'paused' : 'unknown';
  const numeric = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : null;
  const created = typeof goal.created_at === 'string' ? Date.parse(goal.created_at) : NaN;
  const history = Array.isArray(goal.history) ? goal.history.map(grokRecord) : [];
  // A paused or blocked goal's pause message is its current reason; other states report their latest event.
  const reason = status === 'paused' ? goal.pause_message ?? goal.last_event_detail ?? history.at(-1)?.detail
    : goal.last_event_detail ?? goal.pause_message ?? history.at(-1)?.detail;
  const elapsed = numeric(goal.elapsed_ms);
  return {
    backend: 'grok-build', sessionId, threadId: sessionId, objective: goal.objective, status, source: 'native',
    supportedActions: { clear: status !== 'active', stopTurn: status === 'active', pause: status === 'active', resume: status === 'paused' },
    tokenBudget: numeric(goal.token_budget), tokensUsed: numeric(goal.tokens_used ?? goal.tokens_used_high_water),
    timeUsedSeconds: elapsed === null ? null : elapsed / 1000,
    iterations: numeric(goal.total_worker_rounds), lastReason: typeof reason === 'string' ? reason : null,
    createdAt: Number.isFinite(created) ? created : null, updatedAt: Date.now(),
  };
}
