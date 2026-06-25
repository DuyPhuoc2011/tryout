import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { MetricsController } from './metrics.controller';
import { env } from '../config/env';

describe('MetricsController auth gate', () => {
  const snapshot = jest.fn().mockResolvedValue({ totals: { runs: 0 } });
  const controller = new MetricsController({ snapshot } as never);
  const original = env.metricsToken;

  afterAll(() => {
    (env as { metricsToken?: string }).metricsToken = original;
  });

  it('is disabled (403) when METRICS_TOKEN is unset', () => {
    (env as { metricsToken?: string }).metricsToken = undefined;
    expect(() => controller.snapshot('Bearer anything')).toThrow(ForbiddenException);
  });

  it('rejects a wrong token (401)', () => {
    (env as { metricsToken?: string }).metricsToken = 'secret';
    expect(() => controller.snapshot('Bearer nope')).toThrow(UnauthorizedException);
  });

  it('returns the snapshot for a valid Bearer token', async () => {
    (env as { metricsToken?: string }).metricsToken = 'secret';
    await expect(controller.snapshot('Bearer secret')).resolves.toEqual({
      totals: { runs: 0 },
    });
    expect(snapshot).toHaveBeenCalledTimes(1);
  });
});
