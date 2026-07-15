import { Test } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { CatalogService } from './catalog.service';
import { DRIZZLE } from '../db/db.module';

const publishedListing = {
  id: 'listing-1',
  slug: 'pg-disk-full',
  title: 'Postgres Disk Full',
  tagline: 'The database died at 2am. Walk the real recovery.',
  story: '## What happened\n...',
  contents: '- terraform/\n- runbook.md',
  priceCents: 2900,
  currency: 'usd',
};

const mockDb = {
  select: jest.fn().mockReturnThis(),
  from: jest.fn().mockReturnThis(),
  where: jest.fn().mockReturnThis(),
  limit: jest.fn(),
};

describe('CatalogService', () => {
  let service: CatalogService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockDb.select.mockReturnThis();
    mockDb.from.mockReturnThis();
    mockDb.where.mockReturnThis();
    const moduleRef = await Test.createTestingModule({
      providers: [CatalogService, { provide: DRIZZLE, useValue: mockDb }],
    }).compile();
    service = moduleRef.get(CatalogService);
  });

  it('list() selects only summary fields, never contentRepo', async () => {
    mockDb.where.mockResolvedValueOnce([publishedListing]);

    const result = await service.list();

    expect(result).toEqual([publishedListing]);
    // The projection passed to select() must not include contentRepo.
    const projection = mockDb.select.mock.calls[0][0];
    expect(projection).toBeDefined();
    expect(Object.keys(projection)).not.toContain('contentRepo');
    expect(Object.keys(projection)).not.toContain('story');
  });

  it('bySlug() returns the listing detail without contentRepo', async () => {
    mockDb.limit.mockResolvedValueOnce([publishedListing]);

    const result = await service.bySlug('pg-disk-full');

    expect(result).toEqual(publishedListing);
    const projection = mockDb.select.mock.calls[0][0];
    expect(Object.keys(projection)).not.toContain('contentRepo');
  });

  it('bySlug() throws 404 for an unknown or unpublished slug', async () => {
    mockDb.limit.mockResolvedValueOnce([]);

    await expect(service.bySlug('nope')).rejects.toThrow(NotFoundException);
  });
});
