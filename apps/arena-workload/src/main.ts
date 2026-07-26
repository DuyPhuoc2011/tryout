import { loadConfig } from './config';
import { bootstrap, connect } from './db';
import { createHttpServer } from './http';
import { startWorker } from './worker';

async function main(): Promise<void> {
  const config = loadConfig();
  const sql = connect(config.databaseUrl);
  await bootstrap(sql);

  const stopWorker = config.runWorker
    ? startWorker(sql, {
        pollIntervalMs: config.pollIntervalMs,
        concurrency: config.workerConcurrency,
      })
    : () => {};

  const server = createHttpServer(sql, { workerOnly: config.workerOnly });
  server.listen(config.port, () => {
    console.log(
      `arena-workload listening on ${config.port} ` +
        `(worker=${config.runWorker}, workerOnly=${config.workerOnly})`,
    );
  });

  // Cloud Run sends SIGTERM before it takes an instance away. Stopping the
  // poll loop first means a job is never claimed by an instance that is about
  // to disappear — that job would sit 'running' with nothing running it, and
  // the instance-eviction ops event injects exactly this.
  const shutdown = (): void => {
    stopWorker();
    server.close(() => {
      void sql.end({ timeout: 5 }).then(() => process.exit(0));
    });
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((error: unknown) => {
  console.error('arena-workload failed to start', error);
  process.exit(1);
});
