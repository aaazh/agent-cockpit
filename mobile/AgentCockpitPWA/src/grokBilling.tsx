import { useEffect, useState } from 'react';
import type { GrokBillingSnapshot } from '../../../src/contracts/grokBilling';
import type { AgentCockpitAPI } from './api';

export function GrokBilling({ client, profileId, refreshKey }: { client: AgentCockpitAPI; profileId?: string; refreshKey: number }) {
  const id = profileId || 'server-configured-grok-build';
  const [state, setState] = useState<{ id: string; billing: GrokBillingSnapshot | null }>({ id, billing: null });
  useEffect(() => {
    let active = true;
    client.getGrokBilling(id).then(response => {
      if (active) setState({ id, billing: response.billing });
    }).catch(() => { if (active) setState({ id, billing: null }); });
    return () => { active = false; };
  }, [client, id, refreshKey]);
  const billing = state.id === id ? state.billing : null;
  if (!billing) return null;
  return <div className="usage-bar" aria-label="Grok account">
    {billing.subscriptionTier ? <div><span className="usage-label">Grok account</span><span className="usage-value">{billing.subscriptionTier}</span></div> : null}
    {typeof billing.creditUsagePercent === 'number' ? <div><span className="usage-label">Credits used</span><span className="usage-value">{billing.creditUsagePercent.toFixed(1)}%</span></div> : null}
    {typeof billing.prepaidBalanceUsd === 'number' ? <div><span className="usage-label">Prepaid balance</span><span className="usage-value">${billing.prepaidBalanceUsd.toFixed(2)}</span></div> : null}
    {billing.periodEnd && Number.isFinite(Date.parse(billing.periodEnd)) ? <div><span className="usage-label">Resets</span><span className="usage-value">{new Date(billing.periodEnd).toLocaleString()}</span></div> : null}
  </div>;
}
