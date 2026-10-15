export function GrokBillingSection({ data }){
  if (!data) return null;
  const money = value => typeof value === 'number' ? '$' + value.toFixed(2) : null;
  const rows = [
    ['Tier', data.subscriptionTier],
    ['Credits used', typeof data.creditUsagePercent === 'number' ? data.creditUsagePercent.toFixed(1) + '%' : null],
    ['Prepaid balance', money(data.prepaidBalanceUsd)],
    ['On-demand used', money(data.onDemandUsedUsd)],
    ['On-demand cap', money(data.onDemandCapUsd)],
    ['Resets', data.periodEnd && Number.isFinite(Date.parse(data.periodEnd)) ? new Date(data.periodEnd).toLocaleString() : null],
  ];
  return <div className="tt-section">
    <div className="tt-section-label">Grok account</div>
    <div className="tt-rows">{rows.filter(([, value]) => value != null).map(([label, value]) =>
      <div className="tt-kv" key={label}><span>{label}</span><b>{value}</b></div>)}</div>
  </div>;
}
