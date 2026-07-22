import http from 'k6/http';
import { check, group, sleep } from 'k6';
import { Trend } from 'k6/metrics';

// Usage:
//   k6 run perf/catalog.js                          # smoke, localhost
//   BASE_URL=https://api.example.run.app k6 run perf/catalog.js
//   PROFILE=load  k6 run perf/catalog.js
//   PROFILE=stress k6 run perf/catalog.js
//   PROFILE=soak  k6 run perf/catalog.js

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3001';
const PROFILE = __ENV.PROFILE || 'smoke';

// ponytail: stages inline instead of a config module — one file, one place to tune.
const PROFILES = {
  smoke: [{ duration: '30s', target: 1 }],
  load: [
    { duration: '1m', target: 20 },
    { duration: '3m', target: 20 },
    { duration: '1m', target: 0 },
  ],
  // Ramps past the breaking point on purpose. Watch Cloud Run instance count
  // and Postgres connections while this runs — that is the whole exercise.
  stress: [
    { duration: '1m', target: 20 },
    { duration: '2m', target: 100 },
    { duration: '2m', target: 300 },
    { duration: '2m', target: 600 },
    { duration: '1m', target: 0 },
  ],
  soak: [
    { duration: '2m', target: 30 },
    { duration: '56m', target: 30 },
    { duration: '2m', target: 0 },
  ],
};

const dbLatency = new Trend('health_db_latency', true);

export const options = {
  stages: PROFILES[PROFILE],
  thresholds: {
    // SLO, not a vibe. Breaching these fails the run (exit 99) so CI can gate on it.
    http_req_failed: ['rate<0.01'],
    'http_req_duration{endpoint:catalog_list}': ['p(95)<400'],
    'http_req_duration{endpoint:catalog_detail}': ['p(95)<400'],
    'http_req_duration{endpoint:health}': ['p(95)<200'],
    // Login is bcrypt — deliberately slow. Separate budget or it drowns the rest.
    'http_req_duration{endpoint:login}': ['p(95)<1500'],
  },
};

// Pull real slugs once so the detail test hits rows that exist.
export function setup() {
  const res = http.get(`${BASE_URL}/catalog`);
  if (res.status !== 200) {
    throw new Error(`catalog unreachable: ${res.status} ${res.body}`);
  }
  const slugs = res.json().map((l) => l.slug);
  if (slugs.length === 0) {
    throw new Error('no published listings — seed one before load testing');
  }

  // Optional authed path. Skipped unless creds are provided.
  let token = null;
  if (__ENV.TEST_EMAIL && __ENV.TEST_PASSWORD) {
    const login = http.post(
      `${BASE_URL}/auth/login`,
      JSON.stringify({ email: __ENV.TEST_EMAIL, password: __ENV.TEST_PASSWORD }),
      { headers: { 'Content-Type': 'application/json' }, tags: { endpoint: 'login' } },
    );
    if (login.status !== 200) {
      throw new Error(`login failed: ${login.status} ${login.body}`);
    }
    token = login.json().token;
  }

  return { slugs, token };
}

export default function (data) {
  group('catalog browse', () => {
    const list = http.get(`${BASE_URL}/catalog`, { tags: { endpoint: 'catalog_list' } });
    check(list, { 'list 200': (r) => r.status === 200 });

    const slug = data.slugs[Math.floor(Math.random() * data.slugs.length)];
    const detail = http.get(`${BASE_URL}/catalog/${slug}`, {
      tags: { endpoint: 'catalog_detail' },
    });
    check(detail, { 'detail 200': (r) => r.status === 200 });
  });

  // Health does SELECT 1 — isolates DB pool health from app-layer latency.
  // When this climbs but catalog does not, the pool is the bottleneck.
  const health = http.get(`${BASE_URL}/health`, { tags: { endpoint: 'health' } });
  check(health, { 'health ok': (r) => r.status === 200 });
  dbLatency.add(health.timings.duration);

  if (data.token) {
    const me = http.get(`${BASE_URL}/auth/me`, {
      headers: { Authorization: `Bearer ${data.token}` },
      tags: { endpoint: 'me' },
    });
    check(me, { 'me 200': (r) => r.status === 200 });
  }

  // ponytail: flat 1s think time, so 1 VU ~= 1 req/s. Swap for a random range
  // if you need arrival rates that do not synchronise into waves.
  sleep(1);
}
