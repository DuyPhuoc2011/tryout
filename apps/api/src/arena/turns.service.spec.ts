import { Test } from '@nestjs/testing';
import { HttpException, NotFoundException } from '@nestjs/common';
import { TurnsService } from './turns.service';
import { DRIZZLE } from '../db/db.module';
import { MAX_TURNS_PER_HOUR } from './arena.constants';

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

const VALID_DESIGN = [
  'schema_version: 1',
  'api:',
  '  platform: cloudrun',
  '  min_instances: 1',
  '  max_instances: 10',
  '  concurrency: 80',
  '  cpu: 1',
  '  memory: 1Gi',
  'workers:',
  '  placement: separate_service',
  '  min_instances: 1',
  'cache:',
  '  enabled: true',
  '  tier: basic-1gb',
  'db:',
  '  tier: small',
].join('\n');

const INVALID_DESIGN = [
  'schema_version: 1',
  'api:',
  '  platform: cloudrun',
  '  min_instances: 1',
  '  max_instances: 999',
  '  concurrency: 80',
  '  cpu: 1',
  '  memory: 1Gi',
  'workers:',
  '  placement: separate_service',
  '  min_instances: 1',
  'cache:',
  '  enabled: true',
  '  tier: basic-1gb',
  'db:',
  '  tier: small',
].join('\n');

const MALFORMED_YAML = 'api: [unclosed';

const ENV = { id: 'e1', envSlug: 'env-abc123456' };

function resetChain() {
  jest.clearAllMocks();
  mockDb.select.mockReturnThis();
  mockDb.from.mockReturnThis();
  mockDb.where.mockReturnThis();
  mockDb.insert.mockReturnThis();
  mockDb.values.mockReturnThis();
  mockDb.execute.mockResolvedValue(undefined);
  // submit()'s accepted path runs the rate-limit check and the insert inside
  // db.transaction(tx => ...). The tx object has the exact same chainable
  // shape as mockDb, so the callback is simply invoked with mockDb itself —
  // mirrors environments.service.spec.ts.
  mockDb.transaction.mockImplementation((cb: (tx: typeof mockDb) => unknown) => cb(mockDb));
}

/**
 * submit() always does the environment lookup first:
 *   select().from().where().limit()  — resolves at .limit()
 * This is the ONLY read in the rejected-turn path (no rate-limit check, no
 * transaction), so leaving .where() on its default mockReturnThis is enough.
 */
function arrangeLookupOnly(env: typeof ENV | null) {
  mockDb.limit.mockResolvedValueOnce(env ? [env] : []);
}

/**
 * The accepted path additionally runs a rate-limit count query inside the
 * transaction:
 *   select().from().where()  — resolves at .where() (no .limit())
 * Because the environment lookup's .where() call happens first and must
 * still return the chain (not resolve), we queue an explicit "return this"
 * for that first call before queuing the real resolved value for the second
 * (rate-limit) call — otherwise the single override would be consumed by the
 * first call instead of the second.
 */
function arrangeLookupThenRateCount(env: typeof ENV, rateCount: number) {
  mockDb.where.mockReturnValueOnce(mockDb);
  mockDb.limit.mockResolvedValueOnce([env]);
  mockDb.where.mockResolvedValueOnce([{ count: rateCount }]);
}

describe('TurnsService', () => {
  let service: TurnsService;

  beforeEach(async () => {
    resetChain();
    const moduleRef = await Test.createTestingModule({
      providers: [TurnsService, { provide: DRIZZLE, useValue: mockDb }],
    }).compile();
    service = moduleRef.get(TurnsService);
  });

  it('rejects an environment that does not belong to the caller', async () => {
    arrangeLookupOnly(null);
    await expect(service.submit('u1', 'e1', VALID_DESIGN)).rejects.toThrow(NotFoundException);
    expect(mockDb.insert).not.toHaveBeenCalled();
    expect(mockDb.transaction).not.toHaveBeenCalled();
  });

  it('stores a valid design as submitted with rendered tfvars', async () => {
    arrangeLookupThenRateCount(ENV, 0);
    mockDb.returning.mockResolvedValueOnce([{ id: 't1', status: 'submitted' }]);

    const result = await service.submit('u1', 'e1', VALID_DESIGN);

    expect(result).toEqual({ id: 't1', status: 'submitted' });
    const inserted = mockDb.values.mock.calls[0][0];
    expect(inserted.environmentId).toBe('e1');
    expect(inserted.status).toBe('submitted');
    expect(inserted.parseErrors).toBeNull();
    expect(inserted.tfvars.environment_id).toBe(ENV.envSlug);
    expect(inserted.tfvars.api_min_instances).toBe(1);
    expect(inserted.tfvars.worker_service_enabled).toBe(true);
  });

  it('stores an invalid design as rejected, with tfvars null', async () => {
    arrangeLookupOnly(ENV);
    mockDb.returning.mockResolvedValueOnce([{ id: 't2', status: 'rejected' }]);

    const result = await service.submit('u1', 'e1', INVALID_DESIGN);

    expect(result).toEqual({ id: 't2', status: 'rejected' });
    const inserted = mockDb.values.mock.calls[0][0];
    expect(inserted.status).toBe('rejected');
    expect(inserted.tfvars).toBeNull();
    expect(inserted.parseErrors[0].path).toBe('api.max_instances');
  });

  it('returns a rejected turn rather than throwing on malformed YAML', async () => {
    arrangeLookupOnly(ENV);
    mockDb.returning.mockResolvedValueOnce([{ id: 't3', status: 'rejected' }]);

    const result = await service.submit('u1', 'e1', MALFORMED_YAML);

    expect(result).toEqual({ id: 't3', status: 'rejected' });
    const inserted = mockDb.values.mock.calls[0][0];
    expect(inserted.status).toBe('rejected');
    expect(inserted.tfvars).toBeNull();
  });

  it('skips the rate-limit check entirely when the current submission is itself rejected', async () => {
    // No rate-count arrangement at all — if the rejected path touched the
    // rate limit machinery, this would blow up on an unmocked chain.
    //
    // This only proves the CURRENT submission's rejected path never reads
    // the rate-limit count. It does NOT prove that a PRIOR rejected turn is
    // excluded from a LATER accepted submission's count query — that is a
    // real-predicate assertion a mocked count() can't structurally make
    // (see arena-turns-rejected-quota.e2e-spec.ts, which proves it against
    // live Postgres).
    arrangeLookupOnly(ENV);
    mockDb.returning.mockResolvedValueOnce([{ id: 't4', status: 'rejected' }]);

    const result = await service.submit('u1', 'e1', INVALID_DESIGN);

    expect(result.status).toBe('rejected');
  });

  it('refuses a valid design once the hourly limit is reached', async () => {
    arrangeLookupThenRateCount(ENV, MAX_TURNS_PER_HOUR);

    let caught: unknown;
    try {
      await service.submit('u1', 'e1', VALID_DESIGN);
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(HttpException);
    expect((caught as HttpException).message).toMatch(/rate limit|too many/i);
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it('does not take the advisory lock for a rejected turn', async () => {
    arrangeLookupOnly(ENV);
    mockDb.returning.mockResolvedValueOnce([{ id: 't5', status: 'rejected' }]);

    await service.submit('u1', 'e1', INVALID_DESIGN);

    expect(mockDb.transaction).not.toHaveBeenCalled();
  });
});
