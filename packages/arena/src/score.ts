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
  /** Measured cost divided by par cost. 1.0 means par; lower is better. */
  costRatioToPar: number;
  monthlyUsd: number;
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
      failures.push({ axis: 'ops', detail: `SLO broke during "${event.name}"` });
    }
  }

  return {
    passed: failures.length === 0,
    failures,
    costRatioToPar: monthlyUsd / par.parMonthlyUsd,
    monthlyUsd,
  };
}
