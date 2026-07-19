import { scoreRun, type RunMetrics, type ProfilePar, type Verdict } from './score';

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

  describe('boundary: meeting a target exactly passes', () => {
    // Every SLO/cost comparison uses strict `>`. These pin that semantic so
    // flipping any single `>` to `>=` fails a test.
    it('passes when apiP95Ms exactly equals the SLO target', () => {
      const verdict = scoreRun({ ...passingMetrics, apiP95Ms: par.slo.apiP95Ms }, 18, par);
      expect(verdict.passed).toBe(true);
    });

    it('passes when jobStartP95Ms exactly equals the SLO target', () => {
      const verdict = scoreRun(
        { ...passingMetrics, jobStartP95Ms: par.slo.jobStartP95Ms },
        18,
        par,
      );
      expect(verdict.passed).toBe(true);
    });

    it('passes when errorRate exactly equals the SLO target', () => {
      const verdict = scoreRun({ ...passingMetrics, errorRate: par.slo.maxErrorRate }, 18, par);
      expect(verdict.passed).toBe(true);
    });

    it('passes when monthlyUsd exactly equals the budget ceiling', () => {
      const verdict = scoreRun(passingMetrics, par.budgetCeilingUsd, par);
      expect(verdict.passed).toBe(true);
    });
  });

  describe('input validation', () => {
    // Table-driven: one field-path + one score() call per invalid value.
    // Consolidates what was nine near-identical it.each blocks into a single
    // table without dropping any field or invalid-value case.
    interface GuardCase {
      field: string;
      invalidValues: ReadonlyArray<readonly [label: string, value: number]>;
      score: (value: number) => Verdict;
    }

    const guardCases: GuardCase[] = [
      {
        field: 'metrics.apiP95Ms',
        invalidValues: [
          ['NaN', NaN],
          ['negative', -1],
        ],
        score: (v) => scoreRun({ ...passingMetrics, apiP95Ms: v }, 18, par),
      },
      {
        field: 'metrics.jobStartP95Ms',
        invalidValues: [
          ['NaN', NaN],
          ['negative', -1],
        ],
        score: (v) => scoreRun({ ...passingMetrics, jobStartP95Ms: v }, 18, par),
      },
      {
        field: 'metrics.errorRate',
        invalidValues: [
          ['NaN', NaN],
          ['negative', -1],
        ],
        score: (v) => scoreRun({ ...passingMetrics, errorRate: v }, 18, par),
      },
      {
        field: 'monthlyUsd',
        invalidValues: [
          ['NaN', NaN],
          ['negative', -1],
        ],
        score: (v) => scoreRun(passingMetrics, v, par),
      },
      {
        field: 'par.slo.apiP95Ms',
        invalidValues: [
          ['NaN', NaN],
          ['negative', -1],
        ],
        score: (v) => scoreRun(passingMetrics, 18, { ...par, slo: { ...par.slo, apiP95Ms: v } }),
      },
      {
        field: 'par.slo.jobStartP95Ms',
        invalidValues: [
          ['NaN', NaN],
          ['negative', -1],
        ],
        score: (v) =>
          scoreRun(passingMetrics, 18, { ...par, slo: { ...par.slo, jobStartP95Ms: v } }),
      },
      {
        field: 'par.slo.maxErrorRate',
        invalidValues: [
          ['NaN', NaN],
          ['negative', -1],
        ],
        score: (v) =>
          scoreRun(passingMetrics, 18, { ...par, slo: { ...par.slo, maxErrorRate: v } }),
      },
      {
        field: 'par.budgetCeilingUsd',
        invalidValues: [
          ['NaN', NaN],
          ['negative', -1],
        ],
        score: (v) => scoreRun(passingMetrics, 18, { ...par, budgetCeilingUsd: v }),
      },
      {
        field: 'par.parMonthlyUsd',
        invalidValues: [
          ['NaN', NaN],
          ['zero', 0],
          ['negative', -1],
        ],
        score: (v) => scoreRun(passingMetrics, 18, { ...par, parMonthlyUsd: v }),
      },
    ];

    const guardRows = guardCases.flatMap(({ field, invalidValues, score }) =>
      invalidValues.map(([label, value]) => [field, label, value, score] as const),
    );

    it.each(guardRows)('rejects %s = %s, naming it in the error', (field, _label, value, score) => {
      const fieldPattern = new RegExp(field.replace(/\./g, '\\.'));
      expect(() => score(value)).toThrow(fieldPattern);
    });

    it('rejects par.budgetCeilingUsd below par.parMonthlyUsd, naming both fields', () => {
      // A profile whose ceiling is below its own par cost would fail the
      // reference-optimal design on cost, silently, every time.
      expect(() =>
        scoreRun(passingMetrics, 18, { ...par, budgetCeilingUsd: 10, parMonthlyUsd: 20 }),
      ).toThrow(/par\.budgetCeilingUsd.*par\.parMonthlyUsd|par\.parMonthlyUsd.*par\.budgetCeilingUsd/);
    });
  });

  describe('ops event name sanitization', () => {
    it('escapes control characters in an ops event name before it reaches the failure detail', () => {
      const verdict = scoreRun(
        {
          ...passingMetrics,
          opsEvents: [{ name: 'bad\nname\x07', sloHeld: false }],
        },
        18,
        par,
      );
      const opsFailure = verdict.failures.find((f) => f.axis === 'ops');
      expect(opsFailure?.detail).not.toMatch(/[\n\x07]/);
      expect(opsFailure?.detail).toContain('bad\\nname');
    });

    it('caps an excessively long ops event name in the failure detail', () => {
      const longName = 'A'.repeat(400);
      const verdict = scoreRun(
        {
          ...passingMetrics,
          opsEvents: [{ name: longName, sloHeld: false }],
        },
        18,
        par,
      );
      const opsFailure = verdict.failures.find((f) => f.axis === 'ops');
      expect(opsFailure?.detail.length).toBeLessThan(longName.length);
      expect(opsFailure?.detail).toContain('[truncated]');
    });
  });

  describe('ops events presence and shape validation', () => {
    it('rejects an empty opsEvents array, naming the field', () => {
      // Absence of evidence is not evidence of a pass: a run that evaluated
      // no ops events is not a run that survived them.
      expect(() => scoreRun({ ...passingMetrics, opsEvents: [] }, 18, par)).toThrow(
        /metrics\.opsEvents/,
      );
    });

    it('rejects a missing opsEvents field, naming the field, instead of a raw TypeError', () => {
      // Anchored: a native "X is not iterable" TypeError from an unguarded
      // for-of would itself mention "metrics.opsEvents" in its message, so a
      // loose substring match can't tell a controlled error from that raw one.
      const { opsEvents: _omit, ...rest } = passingMetrics;
      const malformed = rest as unknown as RunMetrics;
      expect(() => scoreRun(malformed, 18, par)).toThrow(
        /^scoreRun: metrics\.opsEvents must be an array/,
      );
    });

    it('rejects a non-array opsEvents field, naming the field, instead of a raw TypeError', () => {
      const malformed = { ...passingMetrics, opsEvents: {} } as unknown as RunMetrics;
      expect(() => scoreRun(malformed, 18, par)).toThrow(
        /^scoreRun: metrics\.opsEvents must be an array/,
      );
    });

    it('rejects an ops event with a non-string name', () => {
      const malformed = {
        ...passingMetrics,
        opsEvents: [{ name: 123, sloHeld: true }],
      } as unknown as RunMetrics;
      expect(() => scoreRun(malformed, 18, par)).toThrow(/metrics\.opsEvents\[0\]\.name/);
    });

    it('rejects an ops event with a non-boolean sloHeld', () => {
      const malformed = {
        ...passingMetrics,
        opsEvents: [{ name: 'instance-eviction', sloHeld: 'yes' }],
      } as unknown as RunMetrics;
      expect(() => scoreRun(malformed, 18, par)).toThrow(/metrics\.opsEvents\[0\]\.sloHeld/);
    });
  });
});
