import type { Usage, UsageEvent } from '../../types';
import { grokRecord, type GrokRecord } from './grokProtocol';

function count(value: unknown): number { return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : 0; }

export function normalizeGrokUsage(value: unknown, contextUsagePercentage?: number): Usage {
  const raw = grokRecord(value);
  const cacheReadTokens = count(raw.cachedReadTokens);
  const cacheWriteTokens = count(raw.cacheCreationTokens);
  const reported = typeof raw.costUsdTicks === 'number' && Number.isFinite(raw.costUsdTicks)
    && raw.costUsdTicks >= 0 && raw.usageIsIncomplete !== true && raw.costIsPartial !== true;
  return {
    inputTokens: Math.max(0, count(raw.inputTokens) - cacheReadTokens - cacheWriteTokens),
    outputTokens: count(raw.outputTokens), cacheReadTokens, cacheWriteTokens,
    costUsd: reported ? count(raw.costUsdTicks) / 10_000_000_000 : 0,
    costSource: reported ? 'reported' : 'none',
    ...(contextUsagePercentage !== undefined ? { contextUsagePercentage } : {}),
  };
}

export function grokUsageEvents(value: unknown, contextPercentage?: number, selectedModel?: string): UsageEvent[] {
  const raw = grokRecord(value);
  const models = Object.entries(grokRecord(raw.modelUsage));
  const fields = ['inputTokens', 'outputTokens', 'cachedReadTokens', 'cacheCreationTokens'] as const;
  const aggregateCostReported = normalizeGrokUsage(raw).costSource === 'reported';
  const costReconciles = !aggregateCostReported || models.every(([, model]) => normalizeGrokUsage(model).costSource === 'reported')
    && models.reduce((sum, [, model]) => sum + count(grokRecord(model).costUsdTicks), 0) === raw.costUsdTicks;
  const completeBreakdown = models.length > 0 && fields.every(field =>
    models.reduce((sum, [, model]) => sum + count(grokRecord(model)[field]), 0) === count(raw[field])) && costReconciles;
  if (completeBreakdown) return models.map(([model, usage]) => ({
    type: 'usage', model, usage: normalizeGrokUsage({ ...grokRecord(usage),
      usageIsIncomplete: raw.usageIsIncomplete, costIsPartial: raw.costIsPartial || grokRecord(usage).costIsPartial }, contextPercentage),
  }));
  return [{ type: 'usage', usage: normalizeGrokUsage(raw, contextPercentage),
    model: models.length === 1 ? models[0][0] : models.length > 1 ? 'Mixed Grok models' : selectedModel }];
}

/** Resident counters settle background children and their automatic parent continuation. */
export function grokUsageDelta(beforeValue: unknown, afterValue: unknown): GrokRecord | null {
  const before = grokRecord(beforeValue);
  const after = grokRecord(afterValue);
  const fields = ['inputTokens', 'outputTokens', 'cachedReadTokens', 'cacheCreationTokens', 'modelCalls'] as const;
  const delta = (a: GrokRecord, b: GrokRecord): GrokRecord | null => {
    const result: GrokRecord = {};
    for (const field of fields) {
      const difference = count(b[field]) - count(a[field]);
      if (difference < 0) return null;
      result[field] = difference;
    }
    if (typeof b.costUsdTicks === 'number' && (count(a.modelCalls) === 0 || typeof a.costUsdTicks === 'number')) {
      const difference = b.costUsdTicks - count(a.costUsdTicks);
      if (difference < 0) return null;
      result.costUsdTicks = difference;
    }
    result.costIsPartial = a.costIsPartial === true || b.costIsPartial === true;
    result.usageIsIncomplete = a.usageIsIncomplete === true || b.usageIsIncomplete === true;
    return result;
  };
  const result = delta(before, after);
  if (!result) return null;
  const models: GrokRecord = {};
  for (const [model, value] of Object.entries(grokRecord(after.modelUsage))) {
    const row = delta(grokRecord(grokRecord(before.modelUsage)[model]), grokRecord(value));
    if (!row) return null;
    if (count(row.modelCalls) || count(row.inputTokens) || count(row.outputTokens)) models[model] = row;
  }
  result.modelUsage = models;
  return result;
}
