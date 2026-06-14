import { Controller, Get, Inject } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Db } from '@tryout/db';
import { DRIZZLE } from '../db/db.module';

@Controller('health')
export class HealthController {
  constructor(@Inject(DRIZZLE) private readonly db: Db) {}

  @Get()
  async check() {
    await this.db.execute(sql`SELECT 1`);
    return { status: 'ok' };
  }
}
