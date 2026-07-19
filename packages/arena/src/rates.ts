/**
 * GCP rate table, us-central1. Prices in USD.
 *
 * These figures MUST be verified against current published GCP pricing before
 * any score is shown to a buyer, and re-verified whenever the arena's region
 * changes. They are data precisely so this file is the only thing to update.
 *
 * Source: https://cloud.google.com/run/pricing and
 *         https://cloud.google.com/compute/all-pricing
 * Verified: NOT YET VERIFIED — placeholder values, see M0 in the plan.
 */
export interface RateTable {
  /** Cloud Run, per vCPU-second while a request is being served. */
  cloudRunActiveVcpuSecond: number;
  /** Cloud Run, per GiB-second while a request is being served. */
  cloudRunActiveGibSecond: number;
  /** Cloud Run, per vCPU-second for an idle min-instance. */
  cloudRunIdleVcpuSecond: number;
  /** Cloud Run, per GiB-second for an idle min-instance. */
  cloudRunIdleGibSecond: number;
  /** Cloud Run, per request. */
  cloudRunRequest: number;
  /** Memorystore Redis, per GiB-hour, by tier. */
  redisGibHour: Record<'basic-1gb' | 'standard-1gb', number>;
  /** Database instance, per hour, by tier. */
  dbHour: Record<'micro' | 'small' | 'medium', number>;
}

/**
 * Placeholder values pending verification. The shape is correct and the pricing
 * module is fully tested against a fixture table, so replacing these numbers
 * requires no code change.
 */
export const GCP_RATES: RateTable = {
  cloudRunActiveVcpuSecond: 0.000024,
  cloudRunActiveGibSecond: 0.0000025,
  cloudRunIdleVcpuSecond: 0.0000025,
  cloudRunIdleGibSecond: 0.0000003125,
  cloudRunRequest: 0.0000004,
  redisGibHour: { 'basic-1gb': 0.049, 'standard-1gb': 0.077 },
  dbHour: { micro: 0.0104, small: 0.0416, medium: 0.0832 },
};
