import { eq } from 'drizzle-orm';
import { createDb, schema } from '@tryout/db';
import { loadManifest } from './manifest.js';

export async function seedScenario(id: string): Promise<void> {
  const m = loadManifest(id);
  const db = createDb(
    process.env.DATABASE_URL ?? 'postgres://tryout:tryout@localhost:5432/tryout',
  );

  // ensure track
  const existingTrack = await db
    .select({ id: schema.tracks.id })
    .from(schema.tracks)
    .where(eq(schema.tracks.name, m.track))
    .limit(1);
  const trackId =
    existingTrack.length > 0
      ? existingTrack[0].id
      : (await db.insert(schema.tracks).values({ name: m.track }).returning())[0].id;

  // definition JSONB = the manifest minus the authoring-only `gate` block
  const { gate: _gate, ...definition } = m;

  const values = {
    trackId,
    title: m.title,
    version: m.version,
    definition,
    status: 'active',
    projectType: m.projectType,
    available: m.available,
  };

  const existing = await db
    .select({ id: schema.scenarios.id })
    .from(schema.scenarios)
    .where(eq(schema.scenarios.title, m.title))
    .limit(1);

  if (existing.length > 0) {
    await db.update(schema.scenarios).set(values).where(eq(schema.scenarios.id, existing[0].id));
    console.log(`seeded (updated) "${m.title}"`);
  } else {
    await db.insert(schema.scenarios).values(values);
    console.log(`seeded (inserted) "${m.title}"`);
  }
}
