import type { GrokBillingSnapshot } from '../../contracts/grokBilling';
import type { CliProfile } from '../../types';
import { grokRecord } from './grokProtocol';
import { resolveGrokCliRuntime, startGrokRuntime } from './grokRuntime';

export function normalizeGrokBilling(value: unknown): GrokBillingSnapshot {
  const raw = grokRecord(value);
  const config = grokRecord(raw.config);
  const period = grokRecord(config.currentPeriod);
  const snapshot: GrokBillingSnapshot = { fetchedAt: new Date().toISOString() };
  if (typeof raw.subscription_tier === 'string') snapshot.subscriptionTier = raw.subscription_tier;
  if (typeof config.creditUsagePercent === 'number' && Number.isFinite(config.creditUsagePercent)) snapshot.creditUsagePercent = config.creditUsagePercent;
  for (const [key, value] of [['periodType', period.type], ['periodStart', period.start ?? config.billingPeriodStart], ['periodEnd', period.end ?? config.billingPeriodEnd]] as const) {
    if (typeof value === 'string') snapshot[key] = value;
  }
  for (const [key, field] of [['prepaidBalanceUsd', 'prepaidBalance'], ['onDemandCapUsd', 'onDemandCap'], ['onDemandUsedUsd', 'onDemandUsed']] as const) {
    if (!Object.hasOwn(config, field)) continue;
    if (!config[field] || typeof config[field] !== 'object' || Array.isArray(config[field])) continue;
    // proto3 may omit a zero scalar, making a present Cent object {}.
    const cents = grokRecord(config[field]).val ?? 0;
    if (typeof cents === 'number' && Number.isFinite(cents)) snapshot[key] = cents / 100;
  }
  if (typeof config.isUnifiedBillingUser === 'boolean') snapshot.unifiedBilling = config.isUnifiedBillingUser;
  return snapshot;
}

export class GrokBillingCache {
  private cached = new Map<string, { at: number; value: GrokBillingSnapshot }>();
  private pending = new Map<string, Promise<GrokBillingSnapshot>>();

  async get(profile?: CliProfile): Promise<GrokBillingSnapshot> {
    const key = resolveGrokCliRuntime(profile).profileKey;
    const cached = this.cached.get(key);
    if (cached && Date.now() - cached.at < 60_000) return cached.value;
    const existing = this.pending.get(key);
    if (existing) return existing;
    const fetching = (async () => {
      const runtime = await startGrokRuntime(profile);
      try {
        const value = normalizeGrokBilling(await runtime.client.request('_x.ai/billing'));
        this.cached.set(key, { at: Date.now(), value });
        return value;
      } finally { runtime.client.close(); }
    })();
    this.pending.set(key, fetching);
    try { return await fetching; }
    finally { this.pending.delete(key); }
  }
}
