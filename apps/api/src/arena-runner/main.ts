import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { RunnerModule } from './runner.module';
import { RunnerService } from './runner.service';

type Mode = 'apply' | 'reap';

function parseMode(argv: string[]): Mode {
  const flag = argv.find((arg) => arg.startsWith('--mode='));
  const mode = flag?.slice('--mode='.length) ?? 'apply';

  if (mode !== 'apply' && mode !== 'reap') {
    throw new Error(`Unknown --mode: ${mode}. Expected 'apply' or 'reap'.`);
  }

  return mode;
}

/**
 * Cloud Run Job entrypoint. One tick, then exit.
 *
 * `createApplicationContext` rather than `NestFactory.create`: there is no HTTP
 * server here, and reusing the module system means DbModule and config/env
 * behave identically to the API rather than being reimplemented for the job.
 *
 * Exits nonzero on failure so Cloud Run Jobs records the execution as failed —
 * a job that swallows its own errors is a queue that silently stops draining.
 */
async function bootstrap(): Promise<void> {
  const logger = new Logger('ArenaRunner');
  const mode = parseMode(process.argv.slice(2));
  const app = await NestFactory.createApplicationContext(RunnerModule, {
    logger: ['error', 'warn', 'log'],
  });

  try {
    const runner = app.get(RunnerService);

    if (mode === 'apply') {
      const outcome = await runner.applyOnce();
      logger.log(`apply tick: ${outcome}`);
    } else {
      const { destroyed, failed } = await runner.reapExpired();
      logger.log(`reap tick: destroyed=${destroyed} failed=${failed}`);
    }
  } finally {
    await app.close();
  }
}

bootstrap().catch((error: unknown) => {
  new Logger('ArenaRunner').error(error instanceof Error ? error.stack : String(error));
  process.exitCode = 1;
});
