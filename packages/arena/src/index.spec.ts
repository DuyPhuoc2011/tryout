import * as arena from './index';
import type { ProfilePar } from './score';

// Constructed locally rather than imported: the measured par table arrives with
// the M0 experiment. Values here are a fixture for wiring verification only and
// are deliberately NOT presented as real par figures.
const fixturePar: ProfilePar = {
  profile: 'P1',
  slo: { apiP95Ms: 500, jobStartP95Ms: 30_000, maxErrorRate: 0.005 },
  budgetCeilingUsd: 500,
  parMonthlyUsd: 20,
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

    const cost = arena.costFromUsage({
      windowHours: 1,
      cloudRunActiveVcpuSeconds: 100,
      cloudRunActiveGibSeconds: 100,
      cloudRunIdleVcpuSeconds: 3600,
      cloudRunIdleGibSeconds: 3600,
      requests: 20_000,
      cacheEnabled: parsed.design.cache.enabled,
      cacheTier: parsed.design.cache.tier,
      dbTier: parsed.design.db.tier,
    });
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
    expect(typeof verdict.passed).toBe('boolean');
  });
});
