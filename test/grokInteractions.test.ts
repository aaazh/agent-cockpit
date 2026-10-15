import { GrokInteractions } from '../src/services/backends/grokInteractions';
import type { GrokAcpClient, GrokRpcMessage } from '../src/services/backends/grokProtocol';
import type { StreamEvent } from '../src/types';

function harness(allowTools = true) {
  const client = { respond: jest.fn(), reject: jest.fn(), close: jest.fn() };
  const events: StreamEvent[] = [];
  const interactions = new GrokInteractions(client as unknown as GrokAcpClient, event => events.push(event), allowTools);
  return { client, events, interactions };
}
const question = (id: number, toolCallId: string, ...prompts: string[]): GrokRpcMessage => ({
  id, method: '_x.ai/ask_user_question', params: { toolCallId, questions: prompts.map(text => ({ question: text, options: [{ label: 'Blue' }] })) },
});
const plan = (id: number): GrokRpcMessage => ({ id, method: '_x.ai/exit_plan_mode', params: { toolCallId: `plan-${id}`, planContent: '# Plan' } });

test('permission requests select only an allow-once option and otherwise cancel', () => {
  const { client, interactions } = harness();
  interactions.handle({ id: 1, method: 'session/request_permission', params: { options: [{ kind: 'allow_always', optionId: 'always' }, { kind: 'allow_once', optionId: 'once' }] } });
  interactions.handle({ id: 2, method: 'session/request_permission', params: { options: [{ kind: 'allow_always', optionId: 'always' }, { kind: 'reject_once', optionId: 'reject' }] } });
  expect(client.respond.mock.calls).toEqual([
    [1, { outcome: { outcome: 'selected', optionId: 'once' } }],
    [2, { outcome: { outcome: 'cancelled' } }],
  ]);
});

test('restricted calls reject interactive requests and close the runtime', () => {
  const { client, events, interactions } = harness(false);
  interactions.handle(question(0, 'ask', 'Color?'));
  expect(client.reject).toHaveBeenCalledWith(0, expect.stringContaining('disabled'));
  expect(client.close).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('restricted call') }));
  expect(events).toEqual([]);
});

test('unsupported reverse requests are rejected without presenting a card', () => {
  const { client, events, interactions } = harness();
  interactions.handle({ id: 4, method: 'fs/write_text_file', params: {} });
  expect(client.reject).toHaveBeenCalledWith(4, 'Unsupported Grok client request');
  expect(events).toEqual([]);
});

test('presents multiple questions one at a time and answers them together', () => {
  const { client, events, interactions } = harness();
  interactions.handle(question(0, 'ask', 'Color?', 'Size?'));
  expect(events.at(-1)).toMatchObject({ tool: 'AskUserQuestion', id: 'ask', questions: [{ question: 'Color?' }] });
  expect(interactions.input('Blue')).toBe(true);
  expect(client.respond).not.toHaveBeenCalled();
  expect(events.at(-1)).toMatchObject({ tool: 'AskUserQuestion', questions: [{ question: 'Size?' }] });
  interactions.input('Large');
  expect(client.respond).toHaveBeenCalledWith(0, { outcome: 'accepted', answers: { 'Color?': ['Blue'], 'Size?': ['Large'] } });
  expect(events.at(-1)).toEqual({ type: 'tool_outcomes', outcomes: [{ toolUseId: 'ask', isError: false, outcome: 'answered', status: 'success' }] });
});

test('plans approve only on explicit tokens, abandon on request, and treat other text as revision feedback', () => {
  const { client, interactions } = harness();
  for (const [id, text] of [[1, ' Approve '], [2, 'abandon'], [3, 'ok, go ahead']] as const) {
    interactions.handle(plan(id));
    interactions.input(text);
  }
  expect(client.respond.mock.calls).toEqual([
    [1, { outcome: 'approved' }],
    [2, { outcome: 'abandoned' }],
    [3, { outcome: 'cancelled', feedback: 'ok, go ahead' }],
  ]);
});

test('questions can be skipped, and pending requests are cancelled when the turn ends', () => {
  const { client, interactions } = harness();
  interactions.handle(question(1, 'first', 'Color?'));
  interactions.input('skip');
  interactions.handle(question(2, 'second', 'Color?'));
  interactions.handle(plan(3));
  interactions.cancel();
  expect(client.respond.mock.calls).toEqual([[1, { outcome: 'cancelled' }], [2, { outcome: 'cancelled' }], [3, { outcome: 'cancelled' }]]);
  expect(interactions.input('late')).toBe(false);
});

test('natively resolved requests are dropped and the next pending request is presented', () => {
  const { events, interactions } = harness();
  interactions.handle(question(1, 'first', 'Color?'));
  interactions.handle(plan(2));
  expect(events.at(-1)).toMatchObject({ tool: 'AskUserQuestion', id: 'first' });
  interactions.resolved('first');
  expect(events.slice(-2)).toEqual([
    expect.objectContaining({ tool: 'EnterPlanMode', planAction: 'enter' }),
    expect.objectContaining({ tool: 'ExitPlanMode', id: 'plan-2', planAction: 'exit', planContent: '# Plan' }),
  ]);
});
