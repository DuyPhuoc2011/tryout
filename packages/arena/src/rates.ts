/**
 * GCP rate table, us-central1 (Tier 1). Prices in USD.
 *
 * These figures MUST be re-verified whenever the arena's region changes. They
 * are data precisely so this file is the only thing to update.
 *
 * Source: https://cloud.google.com/run/pricing,
 *         https://cloud.google.com/memorystore/docs/redis/pricing,
 *         https://cloud.google.com/compute/all-pricing
 * Verified: 2026-07-26 against the Cloud Billing Catalog API, which is the
 * billing system's own SKU list rather than a rendered pricing page:
 *
 *   curl -H "Authorization: Bearer $(gcloud.cmd auth print-access-token)" \
 *     "https://cloudbilling.googleapis.com/v1/services/152E-C115-5142/skus?pageSize=500"
 *
 * Re-run that to re-verify. Secondary pricing blogs were tried first and are
 * not trustworthy here: several assert that instance-based rates are "lower"
 * and then quote the request-based figures.
 *
 * VERIFIED — SKU description → field:
 *   Services CPU (Request-based billing)             → cloudRunActiveVcpuSecond
 *   Services Memory (Request-based billing)          → cloudRunActiveGibSecond
 *   Services Min Instance CPU (Request-based)        → cloudRunIdleVcpuSecond
 *   Services Min Instance Memory (Request-based)     → cloudRunIdleGibSecond
 *   Services CPU (Instance-based billing)            → cloudRunAlwaysAllocatedVcpuSecond
 *   Services Memory (Instance-based billing)         → cloudRunAlwaysAllocatedGibSecond
 *   Requests                                         → cloudRunRequest
 *
 * CORRECTED 2026-07-26: cloudRunIdleGibSecond was 0.0000003125, eight times
 * under the actual 0.0000025. It multiplies every min-instance configuration,
 * so it understated exactly the designs the crossover compares.
 *
 * MODELLED, not published — these price things that are deliberately not the
 * SKU they are named after, so "verifying against GCP" does not apply:
 *   redisGibHour  The cache is a per-instance Cloud Run SIDECAR running
 *                 redis:7-alpine, not Memorystore. `basic-1gb` (0.049) does
 *                 match Memorystore Basic M1 at $0.049/GiB-hr, but
 *                 `standard-1gb` (0.077) does not match Memorystore Standard
 *                 at ~$0.098/GiB-hr. Since the module builds the same sidecar
 *                 for both tiers, these are the prices the game charges, not
 *                 quotes for anything being provisioned.
 *   dbHour        All environments share one Postgres VM; db_tier is a
 *                 CONNECTION LIMIT, not a machine size. These are per-tier
 *                 share prices. For reference, on-demand e2 in us-central1 is
 *                 roughly micro $0.0084/hr, small $0.0168/hr, medium
 *                 $0.0335/hr — every value here is above that, and
 *                 intentionally so.
 *
 * The always-allocated pair exists because the split-out worker service runs
 * `cpu_idle = false` — a polling worker cannot function under request-based CPU
 * throttling. Such an instance bills for its entire lifetime at a rate that is
 * neither `active` nor `idle`: cheaper per second than active, far dearer than
 * idle, and with no per-request charge at all. That trade is the whole cost
 * argument for splitting workers out, so it has to be priced, not approximated.
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
  /**
   * Cloud Run instance-based billing, per vCPU-second for the whole instance
   * lifetime. Applies to any service running `cpu_idle = false` — in this
   * arena, the split-out worker.
   */
  cloudRunAlwaysAllocatedVcpuSecond: number;
  /** Cloud Run instance-based billing, per GiB-second for the instance lifetime. */
  cloudRunAlwaysAllocatedGibSecond: number;
  /** Cloud Run, per request. Request-based billing only — instance-based has no request charge. */
  cloudRunRequest: number;
  /** Memorystore Redis, per GiB-hour, by tier. */
  redisGibHour: Record<'basic-1gb' | 'standard-1gb', number>;
  /** Database instance, per hour, by tier. */
  dbHour: Record<'micro' | 'small' | 'medium', number>;
}

/**
 * The pricing module is fully tested against a fixture table, so replacing any
 * of these numbers requires no code change.
 */
export const GCP_RATES: RateTable = {
  cloudRunActiveVcpuSecond: 0.000024,
  cloudRunActiveGibSecond: 0.0000025,
  cloudRunIdleVcpuSecond: 0.0000025,
  cloudRunIdleGibSecond: 0.0000025,
  cloudRunAlwaysAllocatedVcpuSecond: 0.000018,
  cloudRunAlwaysAllocatedGibSecond: 0.000002,
  cloudRunRequest: 0.0000004,
  redisGibHour: { 'basic-1gb': 0.049, 'standard-1gb': 0.077 },
  dbHour: { micro: 0.0104, small: 0.0416, medium: 0.0832 },
};
