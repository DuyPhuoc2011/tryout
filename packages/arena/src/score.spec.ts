import { scoreRun, type RunMetrics, type ProfilePar } from './score';

const par: ProfilePar = {
  profile: 'P1',
  slo: { apiP95Ms: 500, jobStartP95Ms: 30_000, maxErrorRate: 0.005 },
  budgetCeilingUsd: 50,
  parMonthlyUsd: 20,
};

const passingMetrics: RunMetrics = {
  apiP95Ms: 300,
  jobStartP95Ms: 12_000,
  errorRate: 0.001,
  opsEvents: [
    { name: 'instance-eviction', sloHeld: true },
    { name: 'cold-start-storm', sloHeld: true },
    { name: 'dependency-500s', sloHeld: true },
  ],
};

describe('scoreRun', () => {
  it('passes a design that holds SLO, survives ops events, and is under budget', () => {
    const verdict = scoreRun(passingMetrics, 18, par);
    expect(verdict.passed).toBe(true);
    expect(verdict.failures).toEqual([]);
  });

  it('fails on SLO breach regardless of a low cost', () => {
    const verdict = scoreRun({ ...passingMetrics, apiP95Ms: 900 }, 1, par);
    expect(verdict.passed).toBe(false);
    expect(verdict.failures).toContainEqual(
      expect.objectContaining({ axis: 'slo' }),
    );
  });

  it('fails on job-start latency breach', () => {
    const verdict = scoreRun({ ...passingMetrics, jobStartP95Ms: 120_000 }, 18, par);
    expect(verdict.passed).toBe(false);
    expect(verdict.failures).toContainEqual(expect.objectContaining({ axis: 'slo' }));
  });

  it('fails on error rate breach', () => {
    const verdict = scoreRun({ ...passingMetrics, errorRate: 0.02 }, 18, par);
    expect(verdict.passed).toBe(false);
  });

  it('fails when cost exceeds the budget ceiling', () => {
    const verdict = scoreRun(passingMetrics, 75, par);
    expect(verdict.passed).toBe(false);
    expect(verdict.failures).toContainEqual(expect.objectContaining({ axis: 'cost' }));
  });

  it('fails when an ops event broke SLO', () => {
    const verdict = scoreRun(
      {
        ...passingMetrics,
        opsEvents: [
          { name: 'instance-eviction', sloHeld: true },
          { name: 'cold-start-storm', sloHeld: false },
          { name: 'dependency-500s', sloHeld: true },
        ],
      },
      18,
      par,
    );
    expect(verdict.passed).toBe(false);
    expect(verdict.failures).toContainEqual(expect.objectContaining({ axis: 'ops' }));
  });

  it('reports cost efficiency against par', () => {
    const verdict = scoreRun(passingMetrics, 40, par);
    expect(verdict.costRatioToPar).toBeCloseTo(2.0, 10);
  });

  it('reports every failed axis, not only the first', () => {
    const verdict = scoreRun({ ...passingMetrics, apiP95Ms: 900 }, 75, par);
    expect(verdict.failures.map((f) => f.axis).sort()).toEqual(['cost', 'slo']);
  });
});
