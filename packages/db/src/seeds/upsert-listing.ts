import { readFileSync } from 'node:fs';
import { createDb } from '../client';
import * as schema from '../schema';

interface ListingFile {
  slug: string;
  title: string;
  tagline: string;
  story: string;
  contents: string;
  priceCents: number;
  currency?: string;
  contentRepo: string;
  status?: 'draft' | 'published' | 'archived';
}

async function main(): Promise<void> {
  const path = process.argv[2];
  if (!path) {
    console.error('Usage: tsx src/seeds/upsert-listing.ts <listing.json>');
    process.exit(1);
  }
  const raw = JSON.parse(readFileSync(path, 'utf8')) as ListingFile;
  const requiredFields = [
    'slug',
    'title',
    'tagline',
    'story',
    'contents',
    'priceCents',
    'contentRepo',
  ] as const;
  for (const key of requiredFields) {
    if (raw[key] === undefined || raw[key] === '') {
      throw new Error(`Missing required field: ${key}`);
    }
  }

  const db = createDb(
    process.env.DATABASE_URL ?? 'postgres://tryout:tryout@localhost:5432/tryout',
  );
  const values = {
    slug: raw.slug,
    title: raw.title,
    tagline: raw.tagline,
    story: raw.story,
    contents: raw.contents,
    priceCents: raw.priceCents,
    currency: raw.currency ?? 'usd',
    contentRepo: raw.contentRepo,
    status: raw.status ?? 'draft',
    updatedAt: new Date(),
  };
  await db
    .insert(schema.scenarioListings)
    .values(values)
    .onConflictDoUpdate({ target: schema.scenarioListings.slug, set: values });

  console.log(`Upserted listing: ${raw.slug} (status: ${values.status})`);
  // Force a clean exit — the postgres pool otherwise keeps the process alive.
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
