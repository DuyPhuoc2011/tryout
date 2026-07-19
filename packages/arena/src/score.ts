import { sanitizeText } from './text-safety';

export interface SloTargets {
  apiP95Ms: number;
  jobStartP95Ms: number;
  maxErrorRate: number;
}

export interface ProfilePar {
  profile: 'P1' | 'P2';
  slo: SloTargets;
  /** Exceeding this fails the run outright. */
  budgetCeilingUsd: number;
  /** Monthly cost of the measured optimal design. The bar, not the ceiling. */
  parMonthlyUsd: number;
}

export interface OpsEventResult {
  name: string;
  sloHeld: boolean;
}

export interface RunMetrics {
  apiP95Ms: number;
  jobStartP95Ms: number;
  errorRate: number;
  opsEvents: OpsEventResult[];
}

export interface ScoreFailure {
  axis: 'slo' | 'cost' | 'ops';
  detail: string;
}

export interface Verdict {
  passed: boolean;
  failures: ScoreFailure[];
  /**
   * Measured cost divided by par cost. 1.0 means par; lower is better.
   *
   * Only a meaningful cost-efficiency signal when `passed` is true. A failed
   * run's ratio is not a valid cost signal — an SLO-broken design at near-zero
   * cost reports a small, "great" ratio despite being a bad design. Consumers
   * (e.g. a scoreboard) must check `passed` before sorting or filtering on
   * this field, or they reintroduce the cargo-cult reasoning this scorer
   * exists to prevent. Kept present (not nullable) so callers can still use
   * it for diagnostics on a failed run.
   */
  costRatioToPar: number;
  monthlyUsd: number;
}

/** Throws when `value` is not a finite, non-negative number, naming `field` in
 *  the error so the caller can trace the bad input back to its source. */
function requireFiniteNonNegative(value: number, field: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`scoreRun: ${field} must be a finite, non-negative number`);
  }
}

/**
 * Validate that `metrics.opsEvents` is a non-empty array of well-shaped
 * events before anything iterates over it.
 *
 * Two failure modes are guarded here, both worse than a thrown error:
 *  - `opsEvents` missing, `undefined`, or not an array crosses a JSON/HTTP
 *    boundary before reaching this function, so TypeScript's compile-time
 *    guarantee does not hold at runtime; left unguarded, a bare `for...of`
 *    throws a raw, unnamed `TypeError` instead of a clear, greppable error.
 *  - `opsEvents: []` is not merely "no failures" — it is an absence of
 *    evidence that a harness would silently read as a clean ops-axis pass,
 *    exactly the failure mode this module exists to refuse. A run that
 *    evaluated no ops events is not a run that survived them.
 */
function requireValidOpsEvents(opsEvents: unknown): asserts opsEvents is OpsEventResult[] {
  if (!Array.isArray(opsEvents)) {
    throw new Error('scoreRun: metrics.opsEvents must be an array');
  }
  if (opsEvents.length === 0) {
    throw new Error(
      'scoreRun: metrics.opsEvents must not be empty — a run that evaluated no ops events is not a run that survived them',
    );
  }
  opsEvents.forEach((event: unknown, index: number) => {
    if (typeof event !== 'object' || event === null) {
      throw new Error(`scoreRun: metrics.opsEvents[${index}] must be an object`);
    }
    const { name, sloHeld } = event as Record<string, unknown>;
    if (typeof name !== 'string') {
      throw new Error(`scoreRun: metrics.opsEvents[${index}].name must be a string`);
    }
    if (typeof sloHeld !== 'boolean') {
      throw new Error(`scoreRun: metrics.opsEvents[${index}].sloHeld must be a boolean`);
    }
  });
}

/**
 * Validate every input before scoring anything.
 *
 * These values come from our own metrics harness and our own profile
 * configuration, not from untrusted customer input — so throwing is correct
 * here (unlike parseDesign, which returns a result object for genuinely
 * untrusted data). A NaN metric silently passes every `>` comparison, which
 * would certify a design as good on the basis of no evidence; that failure
 * mode is worse than a thrown error, so we refuse to score bad telemetry.
 */
function validateScoreInputs(metrics: RunMetrics, monthlyUsd: number, par: ProfilePar): void {
  requireFiniteNonNegative(metrics.apiP95Ms, 'metrics.apiP95Ms');
  requireFiniteNonNegative(metrics.jobStartP95Ms, 'metrics.jobStartP95Ms');
  requireFiniteNonNegative(metrics.errorRate, 'metrics.errorRate');
  requireFiniteNonNegative(monthlyUsd, 'monthlyUsd');
  requireValidOpsEvents(metrics.opsEvents);

  requireFiniteNonNegative(par.slo.apiP95Ms, 'par.slo.apiP95Ms');
  requireFiniteNonNegative(par.slo.jobStartP95Ms, 'par.slo.jobStartP95Ms');
  requireFiniteNonNegative(par.slo.maxErrorRate, 'par.slo.maxErrorRate');
  requireFiniteNonNegative(par.budgetCeilingUsd, 'par.budgetCeilingUsd');

  if (!Number.isFinite(par.parMonthlyUsd) || par.parMonthlyUsd <= 0) {
    throw new Error('scoreRun: par.parMonthlyUsd must be a finite, positive number');
  }

  // Our own config, same argument as the field checks above: a profile
  // authored with its ceiling below its own par cost would silently fail
  // every run on cost, including the reference-optimal one at par.
  if (par.budgetCeilingUsd < par.parMonthlyUsd) {
    throw new Error(
      `scoreRun: par.budgetCeilingUsd (${par.budgetCeilingUsd}) must be >= par.parMonthlyUsd (${par.parMonthlyUsd})`,
    );
  }
}

/**
 * Score one run on three axes.
 *
 * The SLO gate is hard and cost never redeems a breach: a design that does not
 * work is not a cheap design. Cost discriminates only among designs that hold.
 * This ordering is what stops overprovisioning from being a winning strategy
 * while still refusing to reward a broken-but-cheap answer.
 */
export function scoreRun(
  metrics: RunMetrics,
  monthlyUsd: number,
  par: ProfilePar,
): Verdict {
  validateScoreInputs(metrics, monthlyUsd, par);

  const failures: ScoreFailure[] = [];

  if (metrics.apiP95Ms > par.slo.apiP95Ms) {
    failures.push({
      axis: 'slo',
      detail: `API p95 ${metrics.apiP95Ms}ms exceeds target ${par.slo.apiP95Ms}ms`,
    });
  }
  if (metrics.jobStartP95Ms > par.slo.jobStartP95Ms) {
    failures.push({
      axis: 'slo',
      detail: `Job start p95 ${metrics.jobStartP95Ms}ms exceeds target ${par.slo.jobStartP95Ms}ms`,
    });
  }
  if (metrics.errorRate > par.slo.maxErrorRate) {
    failures.push({
      axis: 'slo',
      detail: `Error rate ${metrics.errorRate} exceeds target ${par.slo.maxErrorRate}`,
    });
  }

  if (monthlyUsd > par.budgetCeilingUsd) {
    failures.push({
      axis: 'cost',
      detail: `$${monthlyUsd.toFixed(2)}/mo exceeds the $${par.budgetCeilingUsd.toFixed(2)} ceiling`,
    });
  }

  for (const event of metrics.opsEvents) {
    if (!event.sloHeld) {
      failures.push({
        axis: 'ops',
        detail: `SLO broke during "${sanitizeText(event.name)}"`,
      });
    }
  }

  return {
    passed: failures.length === 0,
    failures,
    costRatioToPar: monthlyUsd / par.parMonthlyUsd,
    monthlyUsd,
  };
}
