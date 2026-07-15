import { Controller, Get, Param } from '@nestjs/common';
import { CatalogService } from './catalog.service';

/** Public marketplace catalog — no auth: these pages are the marketing funnel. */
@Controller('catalog')
export class CatalogController {
  constructor(private readonly service: CatalogService) {}

  @Get()
  list() {
    return this.service.list();
  }

  @Get(':slug')
  bySlug(@Param('slug') slug: string) {
    return this.service.bySlug(slug);
  }
}
