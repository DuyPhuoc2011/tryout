import http from 'k6/http';
import { check } from 'k6';
import { Trend } from 'k6/metrics';

// M0 traffic generator for the crossover experiment.
//
// Usage:
//   BASE_URL=https://env-x-api-….run.app k6 run -e PROFILE=p1 perf/arena-m0.js
//
// Profiles split into two jobs, because they answer different questions:
//
//   u0,u1,u2,u3  UNIT runs. Short, cheap, one cost driver isolated each.
//                They produce per-request and per-job usage, which compose
//                into a cost at any traffic level without running at it.
//   p1,p2        SLO runs. Full profile shape. They answer "does this
//                configuration hold its SLO", not "what does it cost".
//
// Splitting them is what makes M0 affordable: P1 is 200 jobs/day, so a
// statistically useful job-start p95 at the true rate would need a multi-hour
// run per configuration, twelve times over.

const BASE_URL = __ENV.BASE_URL || 'http://localhost:8080';
const PROFILE = __ENV.PROFILE || 'u1';

// ponytail: profiles inline. One file, one place to tune, and the numbers are
// the specification — they belong next to the thing that implements them.
const READ_WEIGHT = 0.85;

const JOB_SHORT = { durationMs: 10_000, cpuRatio: 0.2 };
const JOB_MEDIUM = { durationMs: 120_000, cpuRatio: 0.2 };
const JOB_LONG = { durationMs: 1_500_000, cpuRatio: 0.2 }; // 25 min — past the point serverless can hide

const apiLatency = new Trend('arena_api_latency', true);

/**
 * P1 bursty shape: a repeating 10-minute cycle averaging exactly 5 rps.
 * 6 min at 2 rps, 3 min at 8 rps, 1 min at 14 rps → (12 + 24 + 14) / 10 = 5.0.
 */
const P1_CYCLE = [
  { duration: '6m', target: 2 },
  { duration: '3m', target: 8 },
  { duration: '1m', target: 14 },
];

const SCENARIOS = {
  // Idle floor. No traffic at all: whatever usage accrues is what the
  // min_instances floor costs, and for a serverless config that is the number
  // the whole always-on argument turns on.
  u0: {
    http: null,
    jobs: null,
    duration: '15m',
  },

  // Per-request unit cost. Flat, boring, no jobs.
  u1: {
    http: { executor: 'constant-arrival-rate', rate: 20, timeUnit: '1s', duration: '10m' },
    jobs: null,
  },

  // Per-job unit cost, short jobs.
  u2: {
    http: null,
    jobs: { executor: 'constant-arrival-rate', rate: 4, timeUnit: '1m', duration: '15m' },
    job: JOB_SHORT,
  },

  // Long-job behaviour. Two 25-minute jobs. On a request-billed Cloud Run
  // service this is where in-process workers stop being viable, so "did it
  // finish at all" is a result, not a precondition.
  u3: {
    http: null,
    jobs: { executor: 'shared-iterations', vus: 2, iterations: 2, maxDuration: '2m' },
    job: JOB_LONG,
  },

  // P1 "Launch": ~5 rps bursty, 200 jobs/day (1 per 432s), 10s jobs.
  p1: {
    http: { executor: 'ramping-arrival-rate', startRate: 2, timeUnit: '1s', stages: P1_CYCLE.concat(P1_CYCLE, P1_CYCLE, P1_CYCLE) },
    jobs: { executor: 'constant-arrival-rate', rate: 1, timeUnit: '432s', duration: '40m' },
    job: JOB_SHORT,
  },

  // P2 "Growth": 150 rps sustained, 8k jobs/day (1 per 10.8s), mixed durations.
  p2: {
    http: { executor: 'constant-arrival-rate', rate: 150, timeUnit: '1s', duration: '40m' },
    jobs: { executor: 'constant-arrival-rate', rate: 100, timeUnit: '1080s', duration: '40m' },
    job: 'mixed',
  },
};

const profile = SCENARIOS[PROFILE];
if (!profile) {
  throw new Error(`unknown PROFILE '${PROFILE}' — expected one of ${Object.keys(SCENARIOS).join(', ')}`);
}

// SMOKE=1 collapses every duration to 20s. Use it to prove the harness reaches
// a freshly applied environment before committing to a 40-minute run — a typo
// in BASE_URL is much cheaper to find now than at minute 39.
if (__ENV.SMOKE === '1') {
  for (const spec of [profile.http, profile.jobs]) {
    if (!spec) continue;
    if (spec.duration) spec.duration = '20s';
    if (spec.maxDuration) spec.maxDuration = '20s';
    if (spec.stages) spec.stages = [{ duration: '20s', target: spec.stages[0].target }];
  }
  if (profile.duration) profile.duration = '20s';
}

function scenario(spec, exec) {
  if (!spec) return null;
  // Only the arrival-rate executors take a VU pool; shared-iterations sizes
  // itself from `vus` and rejects these fields outright.
  const pool = spec.executor.endsWith('arrival-rate')
    ? { preAllocatedVUs: 50, maxVUs: 400 }
    : {};
  return Object.assign({ exec }, pool, spec);
}

const scenarios = {};
const httpScenario = scenario(profile.http, 'httpTraffic');
const jobScenario = scenario(profile.jobs, 'enqueueJob');
if (httpScenario) scenarios.http = httpScenario;
if (jobScenario) scenarios.jobs = jobScenario;
if (!httpScenario && !jobScenario) {
  // u0 still needs one scenario or k6 exits immediately; a single sleeping VU
  // holds the window open without generating load.
  scenarios.idle = {
    executor: 'constant-vus',
    vus: 1,
    duration: profile.duration,
    exec: 'idle',
  };
}

export const options = {
  scenarios,
  // The SLO gate from the design doc, asserted by the harness so a run that
  // misses it is a recorded failure rather than a number to argue about later.
  thresholds: {
    'http_req_failed{scenario:http}': ['rate<0.005'],
    'arena_api_latency': ['p(95)<400'],
  },
};

/** P2's duration mix: 90% short, 8% medium, 2% past twenty minutes. */
function pickJob() {
  const roll = Math.random();
  if (roll < 0.9) return JOB_SHORT;
  if (roll < 0.98) return JOB_MEDIUM;
  return JOB_LONG;
}

export function httpTraffic() {
  const path = Math.random() < READ_WEIGHT ? '/api/read' : '/api/report';
  const res = http.get(`${BASE_URL}${path}`, { tags: { path } });
  apiLatency.add(res.timings.duration);
  check(res, { 'api 200': (r) => r.status === 200 });
}

export function enqueueJob() {
  const body = profile.job === 'mixed' ? pickJob() : profile.job;
  const res = http.post(`${BASE_URL}/api/jobs`, JSON.stringify(body), {
    headers: { 'content-type': 'application/json' },
    tags: { path: '/api/jobs' },
  });
  check(res, { 'job accepted': (r) => r.status === 202 });
}

export function idle() {
  // Deliberately nothing. The window itself is the measurement.
}

/**
 * Queue state is read from the workload rather than from k6: job-start latency
 * is measured at the worker, and k6 only ever sees the 202 from the enqueue.
 */
function queueStats() {
  const res = http.get(`${BASE_URL}/api/jobs/stats`);
  return res.status === 200 ? res.json() : { error: res.status };
}

export function setup() {
  const before = queueStats();
  console.log(`[M0] profile=${PROFILE} base=${BASE_URL}`);
  console.log(`[M0] queue before: ${JSON.stringify(before)}`);
  return { before, startedAt: new Date().toISOString() };
}

export function teardown(data) {
  console.log(`[M0] started: ${data.startedAt}`);
  console.log(`[M0] ended:   ${new Date().toISOString()}`);
  // Jobs outlive the run: a 25-minute job enqueued in a 40-minute window is
  // still draining when k6 exits. Read this again later before recording
  // job-start p95 into the par table.
  console.log(`[M0] queue after: ${JSON.stringify(queueStats())}`);
}
