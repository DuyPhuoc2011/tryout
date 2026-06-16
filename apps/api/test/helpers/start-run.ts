import request from 'supertest';
import type { INestApplication } from '@nestjs/common';

/**
 * Resolve a valid `{ scenarioId, role }` body for POST /scenario-runs against the
 * seeded catalog: the first available scenario and its first selectable role.
 */
export async function resolveStartRunBody(
  app: INestApplication,
  authToken: string,
): Promise<{ scenarioId: string; role: string }> {
  const list = await request(app.getHttpServer())
    .get('/scenarios')
    .set('Authorization', `Bearer ${authToken}`)
    .expect(200);
  const available = (list.body as Array<{ id: string; available: boolean }>).find(
    (s) => s.available,
  );
  if (!available) throw new Error('No available scenario seeded for e2e tests.');

  const detail = await request(app.getHttpServer())
    .get(`/scenarios/${available.id}`)
    .set('Authorization', `Bearer ${authToken}`)
    .expect(200);
  const role = (detail.body as { selectableRoles: string[] }).selectableRoles[0];
  if (!role) throw new Error('Scenario has no selectable role for e2e tests.');

  return { scenarioId: available.id, role };
}

/** Start a run via the API and return its id. */
export async function startRun(app: INestApplication, authToken: string): Promise<string> {
  const body = await resolveStartRunBody(app, authToken);
  const res = await request(app.getHttpServer())
    .post('/scenario-runs')
    .set('Authorization', `Bearer ${authToken}`)
    .send(body)
    .expect(201);
  return res.body.id as string;
}
