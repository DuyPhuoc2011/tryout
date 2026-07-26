import { Test } from '@nestjs/testing';
import { ConflictException, ServiceUnavailableException } from '@nestjs/common';
import { EnvironmentsService } from './environments.service';
import { EntitlementService } from '../entitlement/entitlement.service';
import { DRIZZLE } from '../db/db.module';
import { MAX_CONCURRENT_ENVIRONMENTS } from './arena.constants';

const mockDb = {
  select: jest.fn().mockReturnThis(),
  from: jest.fn().mockReturnThis(),
  where: jest.fn().mockReturnThis(),
  limit: jest.fn(),
  insert: jest.fn().mockReturnThis(),
  values: jest.fn().mockReturnThis(),
  returning: jest.fn(),
  execute: jest.fn(),
  transaction: jest.fn(),
};

const entitlement = { assertOwnsListing: jest.fn() };

function resetChain() {
  jest.clearAllMocks();
  mockDb.select.mockReturnThis();
  mockDb.from.mockReturnThis();
  mockDb.where.mockReturnThis();
  mockDb.insert.mockReturnThis();
  mockDb.values.mockReturnThis();
  mockDb.execute.mockResolvedValue(undefined);
  // create() runs everything inside db.transaction(tx => ...). The tx object
  // has the exact same chainable shape as mockDb, so the callback is simply
  // invoked with mockDb itself — the rest of this suite's chain setup
  // (arrangeReads, .values.mock.calls, etc.) needs no other changes.
  mockDb.transaction.mockImplementation((cb: (tx: typeof mockDb) => unknown) => cb(mockDb));
  entitlement.assertOwnsListing.mockResolvedValue(undefined);
}

/**
 * create() performs two reads in this order:
 *   1. live-environment count  — select().from().where()        resolves at .where()
 *   2. existing env lookup     — select().from().where().limit() resolves at .limit()
 * So the FIRST .where() must resolve and the second must return the chain.
 */
function arrangeReads(opts: { liveCount: number; existing?: unknown }) {
  mockDb.where.mockResolvedValueOnce([{ count: opts.liveCount }]);
  mockDb.limit.mockResolvedValueOnce(opts.existing ? [opts.existing] : []);
}

describe('EnvironmentsService', () => {
  let service: EnvironmentsService;

  beforeEach(async () => {
    resetChain();
    const moduleRef = await Test.createTestingModule({
      providers: [
        EnvironmentsService,
        { provide: DRIZZLE, useValue: mockDb },
        { provide: EntitlementService, useValue: entitlement },
      ],
    }).compile();
    service = moduleRef.get(EnvironmentsService);
  });

  it('checks entitlement before doing anything else', async () => {
    entitlement.assertOwnsListing.mockRejectedValueOnce(new Error('nope'));
    await expect(service.create('u1', 'l1')).rejects.toThrow('nope');
    expect(mockDb.insert).not.toHaveBeenCalled();
    // An unentitled caller must not learn how much capacity is in use, and
    // must never take the advisory lock at all.
    expect(mockDb.select).not.toHaveBeenCalled();
    expect(mockDb.transaction).not.toHaveBeenCalled();
  });

  it('creates an environment with a schema-valid slug and a TTL in the future', async () => {
    arrangeReads({ liveCount: 0 });
    mockDb.returning.mockResolvedValueOnce([{ id: 'e1', envSlug: 'env-abc123' }]);

    const before = Date.now();
    const result = await service.create('u1', 'l1');

    expect(result.id).toBe('e1');
    const inserted = mockDb.values.mock.calls[0][0];
    expect(inserted.userId).toBe('u1');
    expect(inserted.listingId).toBe('l1');
    // Must satisfy both renderTfvars' pattern and the DB CHECK constraint.
    expect(inserted.envSlug).toMatch(/^env-[a-z0-9]{6,32}$/);
    expect(inserted.status).toBe('pending');
    expect(new Date(inserted.ttlExpiresAt).getTime()).toBeGreaterThan(before);
  });

  it('generates a distinct slug on each call', async () => {
    const slugs = new Set<string>();
    for (let i = 0; i < 20; i += 1) {
      resetChain();
      arrangeReads({ liveCount: 0 });
      mockDb.returning.mockResolvedValueOnce([{ id: 'e1' }]);
      // eslint-disable-next-line no-await-in-loop
      await service.create('u1', 'l1');
      slugs.add(mockDb.values.mock.calls[0][0].envSlug);
    }
    expect(slugs.size).toBe(20);
  });

  it('refuses when an environment already exists for this user and listing', async () => {
    arrangeReads({ liveCount: 0, existing: { id: 'e-old', status: 'ready' } });
    await expect(service.create('u1', 'l1')).rejects.toThrow(ConflictException);
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it('refuses when the global concurrency cap is reached', async () => {
    arrangeReads({ liveCount: MAX_CONCURRENT_ENVIRONMENTS });
    await expect(service.create('u1', 'l1')).rejects.toThrow(ServiceUnavailableException);
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it('states that capacity is the reason rather than failing opaquely', async () => {
    arrangeReads({ liveCount: MAX_CONCURRENT_ENVIRONMENTS });
    // A silent stall is the exact failure mode this project's own F09 incident
    // was about. The refusal must say what is happening.
    await expect(service.create('u1', 'l1')).rejects.toThrow(/capacity/i);
  });

  it('refuses (fails closed) when the live count comes back missing or non-numeric', async () => {
    // A bare COUNT(*) with no GROUP BY always returns exactly one row in
    // practice, so this is realistically unreachable — but if it ever did
    // happen, defaulting to 0 would mean "act as if the arena is empty" on a
    // spend ceiling. It must refuse instead.
    mockDb.where.mockResolvedValueOnce([]);
    await expect(service.create('u1', 'l1')).rejects.toThrow(ServiceUnavailableException);
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it('converts a raw unique-violation on insert into a friendly 409', async () => {
    // Backstop for the same-user-same-listing race: the advisory lock closes
    // this in practice, but a raw 23505 (e.g. a client double-click racing
    // two requests) must still surface as ConflictException, not a generic
    // 500 from Nest's default exception filter.
    arrangeReads({ liveCount: 0 });
    const pgUniqueViolation = Object.assign(new Error('duplicate key value'), {
      code: '23505',
    });
    mockDb.returning.mockRejectedValueOnce(pgUniqueViolation);
    await expect(service.create('u1', 'l1')).rejects.toThrow(ConflictException);
  });

  it('mine() returns only the caller rows and never exposes another buyer', async () => {
    resetChain();
    mockDb.where.mockResolvedValueOnce([{ id: 'e1', envSlug: 'env-abc123' }]);
    const result = await service.mine('u1');
    expect(result).toHaveLength(1);
    // The projection must not leak internal columns beyond the read model.
    const projection = mockDb.select.mock.calls[0][0];
    expect(Object.keys(projection).sort()).toEqual(
      ['createdAt', 'envSlug', 'id', 'listingId', 'status', 'ttlExpiresAt'].sort(),
    );
  });
});
