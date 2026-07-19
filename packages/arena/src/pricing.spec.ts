import { costFromUsage, type CostBreakdown, type Usage } from './pricing';
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

  // Finding 3: a windowHours of 1 makes the division a no-op, so the test above
  // cannot distinguish a correct implementation from one that forgot to divide
  // by windowHours before multiplying by 730. This fixture uses windowHours: 3
  // and an expected value computed by hand, independently of the totalForWindow
  // the implementation returns, so a missing division actually fails the test.
  // It exercises both kinds of line item: usage-proportional (active/idle
  // seconds, requests — read as raw counts, not pre-scaled by the window) and
  // time-proportional (cache, db — already multiplied by windowHours).
  it('pins the monthly extrapolation to a hand-computed value over a non-trivial window', () => {
    const usage3h: Usage = {
      windowHours: 3,
      cloudRunActiveVcpuSeconds: 900,
      cloudRunActiveGibSeconds: 450,
      cloudRunIdleVcpuSeconds: 10_800,
      cloudRunIdleGibSeconds: 10_800,
      requests: 300_000,
      cacheEnabled: true,
      cacheTier: 'standard-1gb',
      dbTier: 'medium',
    };

    // Hand-computed independently of the implementation's formula:
    // cloudRunActive = 900*0.001 + 450*0.0001 = 0.9 + 0.045 = 0.945
    // cloudRunIdle   = 10800*0.0001 + 10800*0.00001 = 1.08 + 0.108 = 1.188
    // requests       = 300000*0.000001 = 0.3
    // cache          = 0.1 * 3 = 0.3
    // db             = 0.08 * 3 = 0.24
    // totalForWindow = 0.945 + 1.188 + 0.3 + 0.3 + 0.24 = 2.973
    // monthlyUsd     = (2.973 / 3) * 730 = 0.991 * 730 = 723.43
    const cost = costFromUsage(usage3h, testRates);
    expect(cost.monthlyUsd).toBeCloseTo(723.43, 6);
  });

  it('charges nothing for cache when it is disabled', () => {
    const cost = costFromUsage({ ...usage, cacheEnabled: false }, testRates);
    expect(cost.lineItems.cache).toBe(0);
  });

  it('scales the idle line item with observed idle usage, not with monthlyUsd overall', () => {
    const oneHour = costFromUsage(usage, testRates);
    const twoHour = costFromUsage(
      { ...usage, windowHours: 2, cloudRunIdleVcpuSeconds: 7200, cloudRunIdleGibSeconds: 7200 },
      testRates,
    );

    // Idle seconds double along with the window, so the idle line item itself
    // doubles (it is usage-proportional, not pre-scaled by windowHours).
    expect(twoHour.lineItems.cloudRunIdle).toBeCloseTo(oneHour.lineItems.cloudRunIdle * 2, 10);

    // The idle line item's OWN monthly-equivalent rate (line item / window *
    // 730) is unchanged, because the underlying idle usage rate per hour
    // hasn't changed. This does NOT hold for the overall monthlyUsd: active
    // vCPU/GiB-second usage and requests are held constant while the window
    // doubles, which halves their implied hourly rate and pulls the total
    // down, not "the same monthly rate."
    const idleMonthlyEquivalent = (cost: CostBreakdown, hours: number): number =>
      (cost.lineItems.cloudRunIdle / hours) * 730;
    expect(idleMonthlyEquivalent(twoHour, 2)).toBeCloseTo(idleMonthlyEquivalent(oneHour, 1), 10);
  });

  describe('input validation', () => {
    it.each([
      ['zero', 0],
      ['negative', -1],
      ['NaN', NaN],
      ['Infinity', Infinity],
      ['-Infinity', -Infinity],
    ])('rejects windowHours = %s', (_label, value) => {
      expect(() => costFromUsage({ ...usage, windowHours: value }, testRates)).toThrow(
        /windowHours/,
      );
    });

    it('rejects a negative usage field, naming it in the error', () => {
      expect(() =>
        costFromUsage({ ...usage, cloudRunActiveVcpuSeconds: -1 }, testRates),
      ).toThrow(/cloudRunActiveVcpuSeconds/);
    });

    it('rejects a non-finite usage field, naming it in the error', () => {
      expect(() => costFromUsage({ ...usage, requests: NaN }, testRates)).toThrow(/requests/);
    });

    it('rejects an Infinity usage field, naming it in the error', () => {
      expect(() =>
        costFromUsage({ ...usage, cloudRunIdleGibSeconds: Infinity }, testRates),
      ).toThrow(/cloudRunIdleGibSeconds/);
    });

    // Finding 3: cacheTier/dbTier cross the same JSON/harness boundary that
    // the numeric fields above do, so an out-of-set tier must be caught here
    // -- not left to silently produce `undefined * windowHours` -> NaN, which
    // scoreRun would later report as a generic "monthlyUsd must be finite"
    // error that names the symptom, not the source.
    it('rejects an unrecognized cacheTier when the cache is enabled, naming the field', () => {
      expect(() =>
        costFromUsage(
          { ...usage, cacheEnabled: true, cacheTier: 'ultra-9000' as Usage['cacheTier'] },
          testRates,
        ),
      ).toThrow(/cacheTier/);
    });

    it('rejects an unrecognized dbTier, naming the field', () => {
      expect(() =>
        costFromUsage({ ...usage, dbTier: 'jumbo' as Usage['dbTier'] }, testRates),
      ).toThrow(/dbTier/);
    });

    it('does not require cacheTier to be recognized when the cache is disabled, since it is never indexed in that case', () => {
      expect(() =>
        costFromUsage(
          { ...usage, cacheEnabled: false, cacheTier: 'ultra-9000' as Usage['cacheTier'] },
          testRates,
        ),
      ).not.toThrow();
    });

    // Reviewer finding: `tier in table` walks the prototype chain, so every
    // Object.prototype key (inherited by any plain object literal, including
    // the rate tables) passes an `in`-based guard even though `table[tier]`
    // is not a rate — it is a built-in function/method. That reintroduces the
    // exact silent `undefined * windowHours` -> NaN this guard exists to
    // prevent. These payloads are reachable from the same harness/JSON
    // boundary the guard's own doc comment cites.
    describe.each(['constructor', 'toString', 'hasOwnProperty', 'valueOf'])(
      'prototype-chain bypass: tier = %s',
      (prototypeKey) => {
        it(`rejects cacheTier = "${prototypeKey}" when the cache is enabled, naming the field`, () => {
          expect(() =>
            costFromUsage(
              {
                ...usage,
                cacheEnabled: true,
                cacheTier: prototypeKey as Usage['cacheTier'],
              },
              testRates,
            ),
          ).toThrow(/cacheTier/);
        });

        it(`rejects dbTier = "${prototypeKey}", naming the field`, () => {
          expect(() =>
            costFromUsage({ ...usage, dbTier: prototypeKey as Usage['dbTier'] }, testRates),
          ).toThrow(/dbTier/);
        });
      },
    );
  });
});
