import { Test } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import { OwnershipService } from './ownership.service';
import { DRIZZLE } from '../db/db.module';

const mockDb = {
  select: jest.fn().mockReturnThis(),
  from: jest.fn().mockReturnThis(),
  where: jest.fn().mockReturnThis(),
  limit: jest.fn(),
};

describe('OwnershipService', () => {
  let service: OwnershipService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockDb.select.mockReturnThis();
    mockDb.from.mockReturnThis();
    mockDb.where.mockReturnThis();
    const moduleRef = await Test.createTestingModule({
      providers: [OwnershipService, { provide: DRIZZLE, useValue: mockDb }],
    }).compile();
    service = moduleRef.get(OwnershipService);
  });

  it('resolves for a buyer whose purchase reached invite_sent', async () => {
    mockDb.limit.mockResolvedValueOnce([{ id: 'p1', status: 'invite_sent' }]);
    await expect(service.assertOwnsListing('u1', 'l1')).resolves.toBeUndefined();
  });

  it('resolves for a buyer whose purchase is paid but the invite failed', async () => {
    // An invite failure is our problem, not theirs. They paid; they get access.
    mockDb.limit.mockResolvedValueOnce([{ id: 'p1', status: 'invite_failed' }]);
    await expect(service.assertOwnsListing('u1', 'l1')).resolves.toBeUndefined();
  });

  it('resolves for a purchase that is paid but not yet invited', async () => {
    mockDb.limit.mockResolvedValueOnce([{ id: 'p1', status: 'paid' }]);
    await expect(service.assertOwnsListing('u1', 'l1')).resolves.toBeUndefined();
  });

  it('rejects a buyer with no purchase row', async () => {
    mockDb.limit.mockResolvedValueOnce([]);
    await expect(service.assertOwnsListing('u1', 'l1')).rejects.toThrow(ForbiddenException);
  });

  it('rejects a purchase still pending payment', async () => {
    mockDb.limit.mockResolvedValueOnce([{ id: 'p1', status: 'pending' }]);
    await expect(service.assertOwnsListing('u1', 'l1')).rejects.toThrow(ForbiddenException);
  });

  it('rejects a refunded purchase', async () => {
    mockDb.limit.mockResolvedValueOnce([{ id: 'p1', status: 'refunded' }]);
    await expect(service.assertOwnsListing('u1', 'l1')).rejects.toThrow(ForbiddenException);
  });

  it('gives an identical message whether the purchase is missing or unentitled', async () => {
    // The response must not let a stranger probe which listings a user owns.
    mockDb.limit.mockResolvedValueOnce([]);
    const missing = await service
      .assertOwnsListing('u1', 'l1')
      .catch((e: unknown) => (e as Error).message);
    mockDb.limit.mockResolvedValueOnce([{ id: 'p1', status: 'refunded' }]);
    const unentitled = await service
      .assertOwnsListing('u1', 'l1')
      .catch((e: unknown) => (e as Error).message);
    expect(missing).toBe(unentitled);
  });
});
