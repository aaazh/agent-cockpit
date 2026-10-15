#!/usr/bin/env node
const readline = require('readline');
const fs = require('fs');

if (process.argv.includes('--version')) { process.stdout.write('1.0.52 (fixture)\n'); process.exit(0); }
if (process.argv.includes('login')) { process.stdout.write('Open https://example.test/device and enter FIXTURE-CODE\n'); process.exit(0); }
const trace = process.env.GROK_FIXTURE_TRACE;
const unauthenticated = process.env.GROK_FIXTURE_AUTH === 'none';
const blocked = process.env.GROK_FIXTURE_AUTH === 'blocked';
let authenticated = false;
const modelState = { currentModelId: 'grok-4.7', availableModels: [{ modelId: 'grok-4.7', name: 'Grok 4.7',
  _meta: { reasoningEfforts: [{ value: 'low' }, { value: 'high' }] } }] };
let planPrompt;
function send(message) { process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...message }) + '\n'); }
function requestPlan(revised) {
  send({ id: revised ? 'plan-revised' : 'plan-original', method: '_x.ai/exit_plan_mode',
    params: { sessionId: planPrompt.params.sessionId, toolCallId: revised ? 'plan-tool-2' : 'plan-tool-1', planContent: revised ? '# Revised plan' : '# Original plan' } });
}
readline.createInterface({ input: process.stdin }).on('line', line => {
  const request = JSON.parse(line);
  if (!request.method && planPrompt && request.id === 'plan-original') { requestPlan(true); return; }
  if (!request.method && planPrompt && request.id === 'plan-revised') {
    send({ method: 'session/update', params: { sessionId: planPrompt.params.sessionId, update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'PLAN_DONE' } } } });
    send({ id: planPrompt.id, result: { stopReason: 'end_turn' } });
    planPrompt = null;
    return;
  }
  if (!request.method || request.id === undefined) return;
  if (trace) fs.appendFileSync(trace, JSON.stringify({ method: request.method, params: request.params }) + '\n');
  let result = {};
  switch (request.method) {
    case 'initialize':
      result = { protocolVersion: process.env.GROK_FIXTURE_PROTOCOL ? Number(process.env.GROK_FIXTURE_PROTOCOL) : 1,
        authMethods: [...(unauthenticated ? [] : [{ id: 'cached_token' }]), ...(process.env.XAI_API_KEY && !process.env.GROK_FIXTURE_API_HIDDEN ? [{ id: 'xai.api_key' }] : []), { id: 'grok.com' }],
        agentCapabilities: { sessionCapabilities: { resume: {} } }, _meta: { modelState } }; break;
    case 'authenticate': authenticated = request.params.methodId === (unauthenticated ? 'xai.api_key' : 'cached_token'); break;
    case '_x.ai/auth/check_subscription':
      result = { authenticated: !unauthenticated, meta: { email: 'PRIVATE_ACCOUNT_METADATA',
        gate: blocked ? { message: 'Fixture access is disabled' } : process.env.GROK_FIXTURE_AUTH === 'blocked-empty' ? {} : null } }; break;
    case '_x.ai/billing':
      if (process.env.GROK_FIXTURE_BILLING === 'error') { send({ id: request.id, error: { code: -32603, message: 'Billing unavailable' } }); return; }
      result ={ subscription_tier: 'Fixture Tier', config: { prepaidBalance: { val: 123 }, currentPeriod: { type: 'USAGE_PERIOD_TYPE_WEEKLY', end: '2030-01-01T00:00:00Z' } } }; break;
    case 'session/new':
      if (!authenticated) { send({ id: request.id, error: { code: -32000, message: 'Authentication required' } }); return; }
      result = { sessionId: 'fixture-native' }; break;
    case 'session/prompt':
      if (request.params.prompt[0].text.includes('fixture-plan-revision')) {
        planPrompt = request;
        send({ method: 'session/update', params: { sessionId: request.params.sessionId, update: { sessionUpdate: 'current_mode_update', currentModeId: 'plan' } } });
        requestPlan(false);
        return;
      }
      process.stdout.write(JSON.stringify({ method: 'session/update', params: { sessionId: request.params.sessionId,
        update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: request.params.prompt[0].text } } } }) + '\n');
      result = { stopReason: 'end_turn', _meta: { usage: { inputTokens: 10, outputTokens: 1, costUsdTicks: 100 } } }; break;
    case '_x.ai/session/info': result = { result: { context: { usagePct: 2, toolDefinitionsCount: 0 } } }; break;
  }
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }) + '\n');
});
