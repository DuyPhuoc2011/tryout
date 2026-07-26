/**
 * GCP rate table, us-central1 (Tier 1). Prices in USD.
 *
 * These figures MUST be re-verified whenever the arena's region changes. They
 * are data precisely so this file is the only thing to update.
 *
 * Source: https://cloud.google.com/run/pricing,
 *         https://cloud.google.com/memorystore/docs/redis/pricing,
 *         https://cloud.google.com/compute/all-pricing
 * Verified: 2026-07-26, partially — see the per-field status below.
 *
 * VERIFIED against published Cloud Run Tier 1 pricing:
 *   cloudRunActiveVcpuSecond  0.000024    $0.000024 / vCPU-second
 *   cloudRunActiveGibSecond   0.0000025   $0.00000250 / GiB-second
 *   cloudRunIdleVcpuSecond    0.0000025   $0.0000025 / vCPU-second (min-instance idle)
 *   cloudRunRequest           0.0000004   $0.40 per million requests
 *
 * UNVERIFIED — no published figure located, do not treat as authoritative:
 *   cloudRunIdleGibSecond     0.0000003125
 * Sources consistently quote the idle *CPU* rate and are silent or
 * self-contradictory on idle memory. This number is not derivable from the
 * others and nothing in the search confirmed it.
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
 * MISSING — required before M1-B3 scores a `separate_service` design:
 * an always-allocated (instance-based billing) vCPU-second and GiB-second
 * rate. The split-out worker service runs with `cpu_idle = false` because a
 * polling worker cannot function under request-based CPU throttling, and an
 * always-allocated instance bills for its entire lifetime at a rate that is
 * neither `active` nor `idle`. Pricing a split design with this table
 * understates its cost.
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
 * The pricing module is fully tested against a fixture table, so replacing any
 * of these numbers requires no code change.
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
