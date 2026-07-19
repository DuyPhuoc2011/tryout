import { GCP_RATES, type RateTable } from './rates';

/** Hours in an average month, used to extrapolate a measured window. */
const HOURS_PER_MONTH = 730;

export interface Usage {
  /** Length of the observation window in hours. Must be positive. */
  windowHours: number;
  cloudRunActiveVcpuSeconds: number;
  cloudRunActiveGibSeconds: number;
  cloudRunIdleVcpuSeconds: number;
  cloudRunIdleGibSeconds: number;
  requests: number;
  cacheEnabled: boolean;
  cacheTier: 'basic-1gb' | 'standard-1gb';
  dbTier: 'micro' | 'small' | 'medium';
}

export interface CostBreakdown {
  lineItems: {
    cloudRunActive: number;
    cloudRunIdle: number;
    requests: number;
    cache: number;
    db: number;
  };
  /** Cost of the observed window itself. */
  totalForWindow: number;
  /** Window cost extrapolated to a month. This is the figure buyers are scored on. */
  monthlyUsd: number;
}

/**
 * Convert observed resource usage into a cost breakdown.
 *
 * Deterministic and auditable by design: the same usage vector always yields
 * the same figure, which is what makes scores reproducible. Real billing data
 * is deliberately not used — it arrives days late and carries noise that would
 * make two identical designs score differently.
 */
export function costFromUsage(usage: Usage, rates: RateTable = GCP_RATES): CostBreakdown {
  if (usage.windowHours <= 0) {
    throw new Error('costFromUsage: windowHours must be greater than zero');
  }

  const lineItems = {
    cloudRunActive:
      usage.cloudRunActiveVcpuSeconds * rates.cloudRunActiveVcpuSecond +
      usage.cloudRunActiveGibSeconds * rates.cloudRunActiveGibSecond,
    cloudRunIdle:
      usage.cloudRunIdleVcpuSeconds * rates.cloudRunIdleVcpuSecond +
      usage.cloudRunIdleGibSeconds * rates.cloudRunIdleGibSecond,
    requests: usage.requests * rates.cloudRunRequest,
    cache: usage.cacheEnabled ? rates.redisGibHour[usage.cacheTier] * usage.windowHours : 0,
    db: rates.dbHour[usage.dbTier] * usage.windowHours,
  };

  const totalForWindow = Object.values(lineItems).reduce((sum, item) => sum + item, 0);

  return {
    lineItems,
    totalForWindow,
    monthlyUsd: (totalForWindow / usage.windowHours) * HOURS_PER_MONTH,
  };
}
