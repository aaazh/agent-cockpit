export interface GrokBillingSnapshot {
  fetchedAt: string;
  subscriptionTier?: string;
  creditUsagePercent?: number;
  periodType?: string;
  periodStart?: string;
  periodEnd?: string;
  prepaidBalanceUsd?: number;
  onDemandCapUsd?: number;
  onDemandUsedUsd?: number;
  unifiedBilling?: boolean;
}

export interface GrokBillingResponse {
  profileId: string;
  billing: GrokBillingSnapshot;
}
