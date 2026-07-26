import { Test } from '@nestjs/testing';
import { schema } from '@tryout/db';
import { RunnerService } from './runner.service';
import { TERRAFORM_EXECUTOR, type TerraformExecutor } from './terraform-executor';
import { DRIZZLE } from '../db/db.module';

const mockDb = {
  select: jest.fn().mockReturnThis(),
  from: jest.fn().mockReturnThis(),
  where: jest.fn().mockReturnThis(),
  orderBy: jest.fn().mockReturnThis(),
  limit: jest.fn().mockReturnThis(),
  for: jest.fn(),
  update: jest.fn().mockReturnThis(),
  set: jest.fn().mockReturnThis(),
  transaction: jest.fn(),
};

const terraform: jest.Mocked<TerraformExecutor> = {
  apply: jest.fn(),
  destroy: jest.fn(),
};

const ENV_SLUG = 'env-abc123456';

const VALID_TFVARS = {
  environment_id: ENV_SLUG,
  api_min_instances: 1,
  api_max_instances: 10,
  api_concurrency: 80,
  api_cpu: 1,
  api_memory: '1Gi',
  worker_service_enabled: true,
  worker_min_instances: 1,
  worker_max_instances: 10,
  cache_enabled: true,
  cache_tier: 'basic-1gb',
  db_tier: 'small',
};

function resetChain() {
  jest.clearAllMocks();
  mockDb.select.mockReturnThis();
  mockDb.from.mockReturnThis();
  mockDb.where.mockReturnThis();
  mockDb.orderBy.mockReturnThis();
  mockDb.limit.mockReturnThis();
  mockDb.update.mockReturnThis();
  mockDb.set.mockReturnThis();
  // Both claimTurn() and the record* writers run inside db.transaction(tx => ...).
  // The tx object has the same chainable shape as mockDb, so the callback is
  // invoked with mockDb itself — mirrors turns.service.spec.ts.
  mockDb.transaction.mockImplementation((cb: (tx: typeof mockDb) => unknown) => cb(mockDb));
}

/**
 * claimTurn() performs two reads in this order:
 *   1. turn claim  — select().from().where().orderBy().limit().for()  resolves at .for()
 *   2. environment — select().from().where().limit()                  resolves at .limit()
 * So the FIRST .limit() must return the chain and the SECOND must resolve.
 * The updates that follow resolve on .where(), whose default mockReturnThis
 * is awaitable (a non-thenable object awaits to itself).
 */
function arrangeClaim(turn: unknown, environment?: unknown) {
  mockDb.for.mockResolvedValueOnce(turn ? [turn] : []);
  if (turn) {
    mockDb.limit.mockReturnValueOnce(mockDb);
    mockDb.limit.mockResolvedValueOnce(environment ? [environment] : []);
  }
}

/** reapExpired()'s only read resolves at .limit() — no .for() in that path. */
function arrangeReap(rows: Array<{ id: string; envSlug: string }>) {
  mockDb.limit.mockResolvedValueOnce(rows);
}

/** Payload of each .set() call, in call order. */
function setPayloads(): Array<Record<string, unknown>> {
  return mockDb.set.mock.calls.map((call) => call[0] as Record<string, unknown>);
}

/** Table argument of each .update() call, in call order. */
function updatedTables(): unknown[] {
  return mockDb.update.mock.calls.map((call) => call[0]);
}

describe('RunnerService', () => {
  let service: RunnerService;

  beforeEach(async () => {
    resetChain();
    terraform.apply.mockResolvedValue({ ok: true });
    terraform.destroy.mockResolvedValue({ ok: true });

    const moduleRef = await Test.createTestingModule({
      providers: [
        RunnerService,
        { provide: DRIZZLE, useValue: mockDb },
        { provide: TERRAFORM_EXECUTOR, useValue: terraform },
      ],
    }).compile();
    service = moduleRef.get(RunnerService);
  });

  describe('applyOnce', () => {
    it('is idle on an empty queue, and never reaches Terraform', async () => {
      arrangeClaim(null);

      await expect(service.applyOnce()).resolves.toBe('idle');

      expect(terraform.apply).not.toHaveBeenCalled();
      expect(mockDb.update).not.toHaveBeenCalled();
    });

    it('advances turn and environment through both status machines on success', async () => {
      arrangeClaim(
        { id: 't1', environmentId: 'e1', tfvars: VALID_TFVARS },
        { id: 'e1', envSlug: ENV_SLUG, status: 'pending' },
      );

      await expect(service.applyOnce()).resolves.toBe('applied');

      expect(terraform.apply).toHaveBeenCalledWith(VALID_TFVARS);
      expect(setPayloads().map((payload) => payload.status)).toEqual([
        'applying',
        'provisioning',
        'applied',
        'ready',
      ]);
      expect(updatedTables()).toEqual([
        schema.arenaTurns,
        schema.arenaEnvironments,
        schema.arenaTurns,
        schema.arenaEnvironments,
      ]);
    });

    it('stamps updatedAt on every write', async () => {
      // The carried-forward review item from M1-B1: defaultNow() fires on
      // INSERT only and there is no trigger, so a forgotten column would
      // freeze updatedAt at insert time on exactly the actively-transitioning
      // rows. Asserted mechanically rather than left to review.
      arrangeClaim(
        { id: 't1', environmentId: 'e1', tfvars: VALID_TFVARS },
        { id: 'e1', envSlug: ENV_SLUG, status: 'pending' },
      );

      await service.applyOnce();

      const payloads = setPayloads();
      expect(payloads).toHaveLength(4);
      for (const payload of payloads) {
        expect(payload.updatedAt).toBeInstanceOf(Date);
      }
    });

    it('leaves an already-provisioning environment alone while claiming its turn', async () => {
      arrangeClaim(
        { id: 't1', environmentId: 'e1', tfvars: VALID_TFVARS },
        { id: 'e1', envSlug: ENV_SLUG, status: 'ready' },
      );

      await expect(service.applyOnce()).resolves.toBe('applied');

      // No 'provisioning' write: the pending → provisioning transition is
      // guarded, so a second turn on a live environment does not walk its
      // status backwards.
      expect(setPayloads().map((payload) => payload.status)).toEqual([
        'applying',
        'applied',
        'ready',
      ]);
    });

    it('fails the turn without touching Terraform when the stored tfvars are invalid', async () => {
      arrangeClaim(
        { id: 't1', environmentId: 'e1', tfvars: { ...VALID_TFVARS, unexpected_key: 1 } },
        { id: 'e1', envSlug: ENV_SLUG, status: 'provisioning' },
      );

      await expect(service.applyOnce()).resolves.toBe('apply_failed');

      // The whole point of the read-side re-validation: a shape nobody
      // validated never becomes arguments to a command that creates billable
      // infrastructure.
      expect(terraform.apply).not.toHaveBeenCalled();
      expect(setPayloads().map((payload) => payload.status)).toEqual([
        'applying',
        'apply_failed',
        'degraded',
      ]);
    });

    it('fails the turn without touching Terraform when the tfvars slug does not match', async () => {
      arrangeClaim(
        { id: 't1', environmentId: 'e1', tfvars: VALID_TFVARS },
        { id: 'e1', envSlug: 'env-zzz999999', status: 'provisioning' },
      );

      await expect(service.applyOnce()).resolves.toBe('apply_failed');

      expect(terraform.apply).not.toHaveBeenCalled();
      const failure = setPayloads()[1];
      expect(failure.status).toBe('apply_failed');
      expect((failure.parseErrors as Array<{ message: string }>)[0].message).toMatch(
        /do not match the environment slug/,
      );
    });

    it('records a Terraform failure as apply_failed + degraded', async () => {
      terraform.apply.mockResolvedValueOnce({ ok: false, message: 'quota exceeded' });
      arrangeClaim(
        { id: 't1', environmentId: 'e1', tfvars: VALID_TFVARS },
        { id: 'e1', envSlug: ENV_SLUG, status: 'provisioning' },
      );

      await expect(service.applyOnce()).resolves.toBe('apply_failed');

      expect(setPayloads().map((payload) => payload.status)).toEqual([
        'applying',
        'apply_failed',
        'degraded',
      ]);
      expect(updatedTables()).toEqual([
        schema.arenaTurns,
        schema.arenaTurns,
        schema.arenaEnvironments,
      ]);
    });

    it('sanitizes Terraform stderr before storing it', async () => {
      // Stored failure text is rendered to a buyer in B4, and Terraform stderr
      // can echo values derived from the buyer's own design.
      terraform.apply.mockResolvedValueOnce({
        ok: false,
        message: 'boom\nError: injected line\ttab',
      });
      arrangeClaim(
        { id: 't1', environmentId: 'e1', tfvars: VALID_TFVARS },
        { id: 'e1', envSlug: ENV_SLUG, status: 'provisioning' },
      );

      await service.applyOnce();

      const stored = (setPayloads()[1].parseErrors as Array<{ path: string; message: string }>)[0];
      expect(stored.path).toBe('terraform');
      expect(stored.message).toBe('boom\\nError: injected line\\ttab');
      expect(stored.message).not.toMatch(/[\n\r\t]/);
    });

    it('is idle when the claimed turn has no environment row', async () => {
      arrangeClaim({ id: 't1', environmentId: 'e-gone', tfvars: VALID_TFVARS }, null);

      await expect(service.applyOnce()).resolves.toBe('idle');

      expect(terraform.apply).not.toHaveBeenCalled();
    });
  });

  describe('reapExpired', () => {
    it('destroys expired environments and marks them destroyed', async () => {
      arrangeReap([
        { id: 'e1', envSlug: 'env-aaa111111' },
        { id: 'e2', envSlug: 'env-bbb222222' },
      ]);

      await expect(service.reapExpired()).resolves.toEqual({ destroyed: 2, failed: 0 });

      expect(terraform.destroy.mock.calls.map((call) => call[0])).toEqual([
        'env-aaa111111',
        'env-bbb222222',
      ]);
      expect(setPayloads()).toEqual([
        { status: 'destroyed', updatedAt: expect.any(Date) },
        { status: 'destroyed', updatedAt: expect.any(Date) },
      ]);
    });

    it('leaves a row live when its destroy fails, so the next tick retries', async () => {
      terraform.destroy
        .mockResolvedValueOnce({ ok: false, message: 'state locked' })
        .mockResolvedValueOnce({ ok: true });
      arrangeReap([
        { id: 'e1', envSlug: 'env-aaa111111' },
        { id: 'e2', envSlug: 'env-bbb222222' },
      ]);

      await expect(service.reapExpired()).resolves.toEqual({ destroyed: 1, failed: 1 });

      // Exactly one write, and it is the environment that actually came down.
      // Marking a failed destroy 'destroyed' would leak billable resources
      // silently — the failure this milestone must never produce.
      expect(mockDb.update).toHaveBeenCalledTimes(1);
      expect(setPayloads()).toEqual([{ status: 'destroyed', updatedAt: expect.any(Date) }]);
    });

    it('bounds one tick to five environments', async () => {
      arrangeReap([]);

      await expect(service.reapExpired()).resolves.toEqual({ destroyed: 0, failed: 0 });

      expect(mockDb.limit).toHaveBeenCalledWith(5);
      expect(terraform.destroy).not.toHaveBeenCalled();
      expect(mockDb.update).not.toHaveBeenCalled();
    });
  });
});
