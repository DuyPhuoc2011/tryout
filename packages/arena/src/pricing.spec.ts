import { costFromUsage, type Usage } from './pricing';
import type { RateTable } from './rates';

// Fixture rates chosen so expected costs are exact and hand-checkable.
// Never use GCP_RATES here: real prices change and would break these tests.
const testRates: RateTable = {
  cloudRunActiveVcpuSecond: 0.001,
  cloudRunActiveGibSecond: 0.0001,
  cloudRunIdleVcpuSecond: 0.0001,
  cloudRunIdleGibSecond: 0.00001,
  cloudRunRequest: 0.000001,
  redisGibHour: { 'basic-1gb': 0.05, 'standard-1gb': 0.1 },
  dbHour: { micro: 0.01, small: 0.04, medium: 0.08 },
};

const usage: Usage = {
  windowHours: 1,
  cloudRunActiveVcpuSeconds: 1000,
  cloudRunActiveGibSeconds: 2000,
  cloudRunIdleVcpuSeconds: 3600,
  cloudRunIdleGibSeconds: 3600,
  requests: 1_000_000,
  cacheEnabled: true,
  cacheTier: 'basic-1gb',
  dbTier: 'small',
};

describe('costFromUsage', () => {
  it('computes each line item from usage and rates', () => {
    const cost = costFromUsage(usage, testRates);

    expect(cost.lineItems.cloudRunActive).toBeCloseTo(1000 * 0.001 + 2000 * 0.0001, 10);
    expect(cost.lineItems.cloudRunIdle).toBeCloseTo(3600 * 0.0001 + 3600 * 0.00001, 10);
    expect(cost.lineItems.requests).toBeCloseTo(1.0, 10);
    expect(cost.lineItems.cache).toBeCloseTo(0.05, 10);
    expect(cost.lineItems.db).toBeCloseTo(0.04, 10);
  });

  it('totals the line items', () => {
    const cost = costFromUsage(usage, testRates);
    const sum = Object.values(cost.lineItems).reduce((a, b) => a + b, 0);
    expect(cost.totalForWindow).toBeCloseTo(sum, 10);
  });

  it('extrapolates the window to a monthly figure', () => {
    const cost = costFromUsage(usage, testRates);
    expect(cost.monthlyUsd).toBeCloseTo(cost.totalForWindow * 730, 6);
  });

  it('charges nothing for cache when it is disabled', () => {
    const cost = costFromUsage({ ...usage, cacheEnabled: false }, testRates);
    expect(cost.lineItems.cache).toBe(0);
  });

  it('scales idle cost with the observed window', () => {
    const oneHour = costFromUsage(usage, testRates);
    const twoHour = costFromUsage(
      { ...usage, windowHours: 2, cloudRunIdleVcpuSeconds: 7200, cloudRunIdleGibSeconds: 7200 },
      testRates,
    );
    // Twice the idle seconds over twice the window is the same monthly rate.
    expect(twoHour.monthlyUsd).toBeGreaterThan(0);
    expect(twoHour.lineItems.cloudRunIdle).toBeCloseTo(oneHour.lineItems.cloudRunIdle * 2, 10);
  });

  it('rejects a non-positive window', () => {
    expect(() => costFromUsage({ ...usage, windowHours: 0 }, testRates)).toThrow(
      /windowHours/,
    );
  });
});
