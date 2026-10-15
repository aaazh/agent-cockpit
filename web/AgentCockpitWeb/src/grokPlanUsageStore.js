import { AgentApi } from './api.js';

const cached = new Map();
const pending = new Map();
const subscribers = new Map();

function keyFor(id){ return id || 'server-configured-grok-build'; }
function get(id){ return cached.get(keyFor(id)) || null; }
function subscribe(fn, id){
  const key = keyFor(id);
  const listeners = subscribers.get(key) || new Set();
  listeners.add(fn);
  subscribers.set(key, listeners);
  return () => { listeners.delete(fn); if (!listeners.size) subscribers.delete(key); };
}
function refresh(id){
  const key = keyFor(id);
  if (pending.has(key)) return pending.get(key);
  const fetching = AgentApi.fetch('cli-profiles/' + encodeURIComponent(key) + '/grok-billing')
    .then(async response => {
      if (!response.ok) throw new Error('Grok billing is unavailable');
      const data = await response.json();
      cached.set(key, data.billing);
      return data.billing;
    })
    .catch(() => { cached.delete(key); return null; })
    .finally(() => {
      pending.delete(key);
      for (const fn of subscribers.get(key) || []) fn(get(key));
    });
  pending.set(key, fetching);
  return fetching;
}
export const GrokPlanUsageStore = { get, refresh, subscribe };
