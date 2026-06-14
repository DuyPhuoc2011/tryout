import { Global, Module } from '@nestjs/common';
import { createDb, type Db } from '@tryout/db';
import { env } from '../config/env';

export const DRIZZLE = Symbol('DRIZZLE');

@Global()
@Module({
  providers: [
    {
      provide: DRIZZLE,
      useFactory: (): Db => createDb(env.databaseUrl()),
    },
  ],
  exports: [DRIZZLE],
})
export class DbModule {}
