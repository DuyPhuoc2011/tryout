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

/** Usage fields that must be finite, non-negative numbers. */
const NUMERIC_USAGE_FIELDS = [
  'windowHours',
  'cloudRunActiveVcpuSeconds',
  'cloudRunActiveGibSeconds',
  'cloudRunIdleVcpuSeconds',
  'cloudRunIdleGibSeconds',
  'requests',
] as const;

/**
 * Throws when `tier` is not a key of `table`, naming `field` so the caller
 * can trace the bad input back to its source.
 *
 * `Usage` crosses the same harness/JSON boundary that `RunMetrics.opsEvents`
 * crosses in score.ts, so TypeScript's compile-time guarantee that
 * `cacheTier`/`dbTier` are one of the known literals does not hold at
 * runtime. Left unguarded, an out-of-set tier indexes the rate table to
 * `undefined`, and `undefined * windowHours` silently becomes `NaN` instead
 * of a clear, greppable error.
 *
 * Checks `typeof table[tier] !== 'number'` rather than `tier in table`: `in`
 * walks the prototype chain, so every `Object.prototype` member (
 * `constructor`, `toString`, `hasOwnProperty`, `valueOf`, ...) is inherited
 * by the plain-object rate tables and would pass an `in`-based check even
 * though `table[tier]` is a built-in function, not a rate -- reintroducing
 * the exact silent NaN this guard exists to prevent. The `typeof` check
 * additionally catches a malformed rate table with a non-numeric entry,
 * which `hasOwnProperty` alone would not.
 */
function requireKnownTier(tier: string, table: Record<string, number>, field: string): void {
  if (typeof table[tier] !== 'number') {
    throw new Error(`costFromUsage: ${field} is not a recognized tier`);
  }
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
  for (const field of NUMERIC_USAGE_FIELDS) {
    const value = usage[field];
    if (!Number.isFinite(value) || value < 0) {
      throw new Error(`costFromUsage: ${field} must be a finite, non-negative number`);
    }
  }

  if (usage.windowHours <= 0) {
    throw new Error('costFromUsage: windowHours must be greater than zero');
  }

  // cacheTier is only guarded when the cache is enabled — it is never
  // indexed otherwise (see the `cacheEnabled ? ... : 0` line item below).
  // dbTier has no such flag; it is always indexed.
  if (usage.cacheEnabled) {
    requireKnownTier(usage.cacheTier, rates.redisGibHour, 'cacheTier');
  }
  requireKnownTier(usage.dbTier, rates.dbHour, 'dbTier');

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
