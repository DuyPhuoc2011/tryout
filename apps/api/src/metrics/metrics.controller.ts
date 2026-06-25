import {
  Controller,
  ForbiddenException,
  Get,
  Headers,
  UnauthorizedException,
} from '@nestjs/common';
import { MetricsService } from './metrics.service';
import { env } from '../config/env';

// Gated by a static bearer (METRICS_TOKEN). Not the candidate JWT — this is an
// operator/admin surface. ponytail: single shared token, no role system. Swap
// for org-scoped auth when the institutions dashboard is built.
@Controller('admin/metrics')
export class MetricsController {
  constructor(private readonly metrics: MetricsService) {}

  @Get()
  snapshot(@Headers('authorization') authorization?: string) {
    if (!env.metricsToken) {
      throw new ForbiddenException('Metrics endpoint is disabled (METRICS_TOKEN not set).');
    }
    const token = authorization?.replace(/^Bearer\s+/i, '');
    if (token !== env.metricsToken) {
      throw new UnauthorizedException('Invalid metrics token.');
    }
    return this.metrics.snapshot();
  }
}
