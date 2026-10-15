import { GrokEventDecoder } from '../src/services/backends/grokEvents';
import { grokUsageDelta, grokUsageEvents, normalizeGrokUsage } from '../src/services/backends/grokUsage';
import { normalizeGrokGoal } from '../src/services/backends/grokGoals';
import { grokModels } from '../src/services/backends/grokModels';
import { cleanGoalObjectiveText } from '../src/services/chat/goalEventMessages';

describe('Grok event ownership and projection', () => {
  test('server normalization cleans pasted Grok goal headers while preserving ordinary objectives', () => {
    expect(cleanGoalObjectiveText('Goal setgrok-buildShip Grok support')).toBe('Ship Grok support');
    expect(cleanGoalObjectiveText('Goal setGrok BuildShip Grok support')).toBe('Ship Grok support');
    expect(cleanGoalObjectiveText('Grok Build should keep this prefix')).toBe('Grok Build should keep this prefix');
  });
  test('keeps child text out of the parent response and groups child tools', () => {
    const decoder = new GrokEventDecoder('root');
    const message = (sessionId: string, update: Record<string, unknown>) => ({ method: 'session/update', params: { sessionId, update } });
    expect(decoder.decode(message('root', { sessionUpdate: 'subagent_spawned', parent_session_id: 'root', child_session_id: 'child', description: 'Inspect file' }))[0])
      .toMatchObject({ type: 'tool_activity', id: 'child', isAgent: true });
    expect(decoder.decode(message('child', { sessionUpdate: 'agent_message_chunk', content: { text: 'CHILD_ONLY' } }))).toEqual([]);
    expect(decoder.decode(message('child', { sessionUpdate: 'tool_call', toolCallId: 'read-1', title: 'read_file' }))[0])
      .toMatchObject({ tool: 'Read', parentAgentId: 'child' });
    decoder.decode(message('root', { sessionUpdate: 'agent_message_chunk', content: { text: 'ROOT_FINAL' } }));
    expect(decoder.finalText).toBe('ROOT_FINAL');
    expect(decoder.decode(message('unrelated', { sessionUpdate: 'agent_message_chunk', content: { text: 'OTHER' } }))).toEqual([]);
  });

  test('deduplicates tool completion and generated media paths', () => {
    const decoder = new GrokEventDecoder('root');
    const message = { method: 'session/update', params: { sessionId: 'root', update: { sessionUpdate: 'tool_call_update', toolCallId: 'image',
      status: 'completed', rawOutput: { type: 'ImageGen', path: '/tmp/generated.png', filename: 'generated.png' } } } };
    expect(decoder.decode(message)).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'artifact', sourcePath: '/tmp/generated.png' })]));
    expect(decoder.decode(message)).toEqual([]);
  });

  test('groups streamed child thoughts in one activity and completes it once', () => {
    const decoder = new GrokEventDecoder('root');
    const update = (sessionId: string, value: Record<string, unknown>) => decoder.decode({ method: 'session/update', params: { sessionId, update: value } });
    update('root', { sessionUpdate: 'subagent_spawned', parent_session_id: 'root', child_session_id: 'child', subagent_id: 'native-task' });
    expect(update('child', { sessionUpdate: 'agent_thought_chunk', content: { text: 'First ' } })).toEqual([
      expect.objectContaining({ type: 'tool_activity', id: 'child:thinking', parentAgentId: 'child' }),
    ]);
    expect(update('child', { sessionUpdate: 'agent_thought_chunk', content: { text: 'second' } })).toEqual([]);
    const finish = { sessionUpdate: 'subagent_finished', child_session_id: 'child', status: 'completed', output: 'Child done' };
    const events = update('root', finish);
    expect(events.flatMap(event => event.type === 'tool_outcomes' ? event.outcomes : [])).toEqual(expect.arrayContaining([
      expect.objectContaining({ toolUseId: 'child:thinking', outcome: 'First second', status: 'success' }),
    ]));
    expect(update('root', finish)).toEqual([]);
    expect(decoder.finalText).toBe('');
  });

  test('separates final answer from pre-tool narration', () => {
    const decoder = new GrokEventDecoder('root');
    for (const update of [
      { sessionUpdate: 'agent_message_chunk', content: { text: 'I will inspect the file.' } },
      { sessionUpdate: 'tool_call', toolCallId: 'read', title: 'read_file' },
      { sessionUpdate: 'agent_message_chunk', content: { text: 'FINAL' } },
    ]) decoder.decode({ method: 'session/update', params: { sessionId: 'root', update } });
    expect(decoder.finalText).toBe('FINAL');
  });
});

test('normalizes full input/cache subsets and never adds reasoning twice', () => {
  expect(normalizeGrokUsage({ inputTokens: 4020, cachedReadTokens: 1152, outputTokens: 42, reasoningTokens: 36, costUsdTicks: 22317600 }))
    .toMatchObject({ inputTokens: 2868, cacheReadTokens: 1152, outputTokens: 42, costUsd: 0.00223176, costSource: 'reported' });
  expect(normalizeGrokUsage({ costUsdTicks: 123, costIsPartial: true })).toMatchObject({ costSource: 'none', costUsd: 0 });
  expect(normalizeGrokUsage({ usageIsIncomplete: true })).toMatchObject({ costSource: 'none' });
});

test('splits complete mixed-model usage without adding the root aggregate twice', () => {
  const events = grokUsageEvents({ inputTokens: 30, outputTokens: 3, cachedReadTokens: 10, modelUsage: {
    'grok-4.7-build': { inputTokens: 20, outputTokens: 2, cachedReadTokens: 10, costUsdTicks: 100 },
    'grok-4.6-build': { inputTokens: 10, outputTokens: 1, costUsdTicks: 200 },
  } });
  expect(events.map(event => event.model)).toEqual(['grok-4.7-build', 'grok-4.6-build']);
  expect(events.reduce((total, event) => total + event.usage.inputTokens + event.usage.cacheReadTokens, 0)).toBe(30);
  expect(events.reduce((total, event) => total + event.usage.outputTokens, 0)).toBe(3);
});

test('retains complete aggregate cost when per-model costs do not reconcile', () => {
  const events = grokUsageEvents({ inputTokens: 30, outputTokens: 3, costUsdTicks: 300, modelUsage: {
    'grok-4.7-build': { inputTokens: 20, outputTokens: 2, costUsdTicks: 100 },
    'grok-4.6-build': { inputTokens: 10, outputTokens: 1 },
  } });
  expect(events).toEqual([expect.objectContaining({ model: 'Mixed Grok models', usage: expect.objectContaining({ inputTokens: 30, outputTokens: 3, costUsd: 300 / 1e10, costSource: 'reported' }) })]);
});

test('resident usage deltas preserve process epochs and do not trust partial cost', () => {
  expect(grokUsageDelta({ inputTokens: 10, modelCalls: 1, costUsdTicks: 10 }, { inputTokens: 30, modelCalls: 2, costUsdTicks: 30 }))
    .toMatchObject({ inputTokens: 20, modelCalls: 1, costUsdTicks: 20 });
  expect(grokUsageDelta({ inputTokens: 30 }, { inputTokens: 0 })).toBeNull();
  expect(grokUsageDelta({ inputTokens: 10, modelCalls: 1 }, { inputTokens: 30, modelCalls: 2, costUsdTicks: 30 })?.costUsdTicks).toBeUndefined();
});

test('decodes live and persisted goals without equating budgets to hard caps', () => {
  expect(normalizeGrokGoal({ objective: 'Do work', status: 'budget_limited', token_budget: 1, tokens_used_high_water: 27796, phase: 'Idle' }, 'native'))
    .toMatchObject({ backend: 'grok-build', status: 'budgetLimited', tokenBudget: 1, tokensUsed: 27796 });
  expect(normalizeGrokGoal({ objective: 'Do work', status: 'user_paused', tokens_used: 3 }, 'native'))
    .toMatchObject({ status: 'paused', tokensUsed: 3, supportedActions: { resume: true } });
  expect(normalizeGrokGoal({ objective: 'Do work', status: 'blocked', pause_message: 'Need missing input' }, 'native'))
    .toMatchObject({ status: 'paused', lastReason: 'Need missing input', supportedActions: { resume: true } });
  expect(normalizeGrokGoal(null, 'native')).toBeNull();
});

test('paused goals report their pause message, and non-finite elapsed time is omitted', () => {
  const goal = { objective: 'Do work', pause_message: 'Need missing input', last_event_detail: 'Worker round finished' };
  expect(normalizeGrokGoal({ ...goal, status: 'blocked', elapsed_ms: NaN }, 'native'))
    .toMatchObject({ status: 'paused', lastReason: 'Need missing input', timeUsedSeconds: null });
  expect(normalizeGrokGoal({ ...goal, status: 'active', elapsed_ms: 1500 }, 'native'))
    .toMatchObject({ status: 'active', lastReason: 'Worker round finished', timeUsedSeconds: 1.5 });
});

test('reads native effort/model IDs and enables only verified model media', () => {
  const models = grokModels({ currentModelId: 'grok-4.7', availableModels: [
    { modelId: 'grok-4.7', name: 'Grok 4.7', _meta: { reasoningEfforts: [{ value: 'xhigh' }, { value: 'unknown' }] } },
    { modelId: 'grok-4.7-build-fast', name: 'Grok 4.7 Fast' },
  ] });
  expect(models[0]).toMatchObject({ default: true, supportedEffortLevels: ['xhigh'], capabilities: { input: { image: true, pdf: true } } });
  expect(models[1]).toMatchObject({ id: 'grok-4.7-build-fast', capabilities: { input: { image: false } } });
});
