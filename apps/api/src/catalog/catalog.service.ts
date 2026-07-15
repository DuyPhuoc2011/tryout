import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { schema, type Db } from '@tryout/db';
import { DRIZZLE } from '../db/db.module';

@Injectable()
export class CatalogService {
  constructor(@Inject(DRIZZLE) private readonly db: Db) {}

  /** Published listings, summary fields only. contentRepo must never leave the API. */
  async list() {
    return this.db
      .select({
        id: schema.scenarioListings.id,
        slug: schema.scenarioListings.slug,
        title: schema.scenarioListings.title,
        tagline: schema.scenarioListings.tagline,
        priceCents: schema.scenarioListings.priceCents,
        currency: schema.scenarioListings.currency,
      })
      .from(schema.scenarioListings)
      .where(eq(schema.scenarioListings.status, 'published'));
  }

  async bySlug(slug: string) {
    const [listing] = await this.db
      .select({
        id: schema.scenarioListings.id,
        slug: schema.scenarioListings.slug,
        title: schema.scenarioListings.title,
        tagline: schema.scenarioListings.tagline,
        story: schema.scenarioListings.story,
        contents: schema.scenarioListings.contents,
        priceCents: schema.scenarioListings.priceCents,
        currency: schema.scenarioListings.currency,
      })
      .from(schema.scenarioListings)
      .where(
        and(
          eq(schema.scenarioListings.slug, slug),
          eq(schema.scenarioListings.status, 'published'),
        ),
      )
      .limit(1);
    if (!listing) throw new NotFoundException('Listing not found');
    return listing;
  }
}
