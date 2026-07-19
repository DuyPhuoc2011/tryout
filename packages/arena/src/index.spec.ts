import * as arena from './index';
import type { ProfilePar } from './score';
import type { RateTable } from './rates';

// Constructed locally rather than imported: the measured par table arrives with
// the M0 experiment. Values here are a fixture for wiring verification only and
// are deliberately NOT presented as real par figures.
const fixturePar: ProfilePar = {
  profile: 'P1',
  slo: { apiP95Ms: 500, jobStartP95Ms: 30_000, maxErrorRate: 0.005 },
  budgetCeilingUsd: 500,
  parMonthlyUsd: 20,
};

// Fixture rates, not GCP_RATES: this is a wiring test, not a pricing test, so
// it must not become rate-dependent when GCP_RATES is later replaced with
// measured values. Chosen so the run stays comfortably under fixturePar's
// $500 ceiling regardless of exactly how GCP_RATES is measured later.
const fixtureRates: RateTable = {
  cloudRunActiveVcpuSecond: 0.0001,
  cloudRunActiveGibSecond: 0.00001,
  cloudRunIdleVcpuSecond: 0.00001,
  cloudRunIdleGibSecond: 0.000001,
  cloudRunRequest: 0.0000005,
  redisGibHour: { 'basic-1gb': 0.01, 'standard-1gb': 0.02 },
  dbHour: { micro: 0.005, small: 0.01, medium: 0.02 },
};

describe('@tryout/arena public surface', () => {
  it('exports the functions consumers need', () => {
    expect(typeof arena.parseDesign).toBe('function');
    expect(typeof arena.renderTfvars).toBe('function');
    expect(typeof arena.costFromUsage).toBe('function');
    expect(typeof arena.scoreRun).toBe('function');
  });

  it('exports the rate table and the schema', () => {
    expect(arena.GCP_RATES).toBeDefined();
    expect(arena.designSchema).toBeDefined();
    expect(arena.SCHEMA_VERSION).toBe(1);
  });

  it('carries a design end to end from YAML to a verdict', () => {
    const yaml = [
      'schema_version: 1',
      'api:',
      '  platform: cloudrun',
      '  min_instances: 1',
      '  max_instances: 10',
      '  concurrency: 80',
      '  cpu: 1',
      '  memory: 1Gi',
      'workers:',
      '  placement: separate_service',
      '  min_instances: 1',
      'cache:',
      '  enabled: true',
      '  tier: basic-1gb',
      'db:',
      '  tier: small',
    ].join('\n');

    const parsed = arena.parseDesign(yaml);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error('expected ok');

    const tfvars = arena.renderTfvars(parsed.design, 'env-abc123');
    expect(tfvars.worker_service_enabled).toBe(true);

    const cost = arena.costFromUsage(
      {
        windowHours: 1,
        cloudRunActiveVcpuSeconds: 100,
        cloudRunActiveGibSeconds: 100,
        cloudRunIdleVcpuSeconds: 3600,
        cloudRunIdleGibSeconds: 3600,
        requests: 20_000,
        cacheEnabled: parsed.design.cache.enabled,
        cacheTier: parsed.design.cache.tier,
        dbTier: parsed.design.db.tier,
      },
      fixtureRates,
    );
    expect(cost.monthlyUsd).toBeGreaterThan(0);

    const verdict = arena.scoreRun(
      {
        apiP95Ms: 200,
        jobStartP95Ms: 5_000,
        errorRate: 0,
        opsEvents: [{ name: 'instance-eviction', sloHeld: true }],
      },
      cost.monthlyUsd,
      fixturePar,
    );
    // Asserts the actual outcome, not merely that `passed` has the right
    // type: with this fixture the run genuinely holds every SLO, survives
    // its ops event, and stays under budget, so a scoring inversion or a
    // silently-skipped axis would previously slip past this test undetected.
    expect(verdict.passed).toBe(true);
    expect(verdict.failures).toEqual([]);
  });
});
