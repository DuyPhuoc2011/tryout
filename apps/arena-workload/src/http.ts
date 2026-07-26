import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { Sql } from './db';
import { enqueue, stats } from './queue';

// ponytail: node:http and a switch, not a framework. Four routes, and a
// framework in the image is dependency surface inside a buyer's environment.

const DEFAULT_JOB_MS = 10_000;
const DEFAULT_CPU_RATIO = 0.2;

function json(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    // Bounded: this endpoint is reachable by the load harness and, in a
    // scenario, by anything the buyer points at it.
    if (size > 8192) throw new Error('body too large');
    chunks.push(chunk as Buffer);
  }
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
}

function num(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function createHttpServer(sql: Sql, opts: { workerOnly: boolean }): Server {
  return createServer((req, res) => {
    void handle(req, res, sql, opts).catch((error: unknown) => {
      console.error('request failed', error);
      if (!res.headersSent) json(res, 500, { error: 'internal' });
    });
  });
}

async function handle(
  req: IncomingMessage,
  res: ServerResponse,
  sql: Sql,
  opts: { workerOnly: boolean },
): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const route = `${req.method} ${url.pathname}`;

  // Cloud Run health-probes every service, including the split-out worker.
  // The worker serves this and nothing else: it has no business accepting
  // traffic, and INGRESS_TRAFFIC_INTERNAL_ONLY is a network control, not an
  // application one.
  if (route === 'GET /healthz') return json(res, 200, { ok: true });
  if (opts.workerOnly) return json(res, 404, { error: 'worker' });

  switch (route) {
    case 'GET /api/read': {
      // The cheap read: one round trip, so API p95 tracks instance
      // availability and connection-pool health rather than query cost.
      const [row] = await sql<{ now: Date }[]>`select now() as now`;
      return json(res, 200, { now: row.now });
    }

    case 'GET /api/report': {
      // The expensive read: a real aggregate over the jobs table, so db_tier
      // and instance count both show up in latency under load.
      const rows = await sql<{ status: string; count: string }[]>`
        select status, count(*)::text as count from workload_jobs group by status
      `;
      return json(res, 200, { rows });
    }

    case 'POST /api/jobs': {
      const body = await readBody(req);
      const job = await enqueue(
        sql,
        num(body.durationMs, DEFAULT_JOB_MS),
        num(body.cpuRatio, DEFAULT_CPU_RATIO),
      );
      return json(res, 202, job);
    }

    case 'GET /api/jobs/stats':
      return json(res, 200, await stats(sql));

    default:
      return json(res, 404, { error: 'not found' });
  }
}
