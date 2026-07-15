import { Test } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { PurchasesService } from './purchases.service';
import { StripeService } from './stripe.service';
import { GitHubService } from '../github/github.service';
import { DRIZZLE } from '../db/db.module';

process.env.GITHUB_OWNER = 'test-owner';

const listing = {
  id: 'listing-1',
  title: 'Postgres Disk Full',
  priceCents: 2900,
  currency: 'usd',
  contentRepo: 'scenario-pg-disk-full',
  status: 'published',
};

const mockDb = {
  select: jest.fn().mockReturnThis(),
  from: jest.fn().mockReturnThis(),
  where: jest.fn().mockReturnThis(),
  limit: jest.fn(),
  insert: jest.fn().mockReturnThis(),
  values: jest.fn().mockReturnThis(),
  update: jest.fn().mockReturnThis(),
  set: jest.fn().mockReturnThis(),
  innerJoin: jest.fn().mockReturnThis(),
  returning: jest.fn(),
};

const mockStripe = {
  createCheckoutSession: jest.fn(),
  expireCheckoutSession: jest.fn(),
  constructEvent: jest.fn(),
};

const mockGitHub = {
  addRepoCollaborator: jest.fn(),
};

function resetChains() {
  jest.clearAllMocks();
  mockDb.select.mockReturnThis();
  mockDb.from.mockReturnThis();
  mockDb.where.mockReturnThis();
  mockDb.insert.mockReturnThis();
  mockDb.values.mockReturnThis();
  mockDb.update.mockReturnThis();
  mockDb.set.mockReturnThis();
  mockDb.innerJoin.mockReturnThis();
}

async function makeService(): Promise<PurchasesService> {
  const moduleRef = await Test.createTestingModule({
    providers: [
      PurchasesService,
      { provide: DRIZZLE, useValue: mockDb },
      { provide: StripeService, useValue: mockStripe },
      { provide: GitHubService, useValue: mockGitHub },
    ],
  }).compile();
  return moduleRef.get(PurchasesService);
}

describe('PurchasesService.checkout', () => {
  let service: PurchasesService;

  beforeEach(async () => {
    resetChains();
    service = await makeService();
  });

  it('throws 404 for an unknown or unpublished listing', async () => {
    mockDb.limit.mockResolvedValueOnce([]); // listing lookup

    await expect(service.checkout('user-1', 'nope')).rejects.toThrow(NotFoundException);
    expect(mockStripe.createCheckoutSession).not.toHaveBeenCalled();
  });

  it('throws 400 when the user has no GitHub username and none is provided', async () => {
    mockDb.limit
      .mockResolvedValueOnce([listing]) // listing lookup
      .mockResolvedValueOnce([{ id: 'user-1', githubUsername: null }]); // user lookup

    await expect(service.checkout('user-1', 'listing-1')).rejects.toThrow(BadRequestException);
    expect(mockStripe.createCheckoutSession).not.toHaveBeenCalled();
  });

  it('throws 409 when the listing is already purchased', async () => {
    mockDb.limit
      .mockResolvedValueOnce([listing]) // listing lookup
      .mockResolvedValueOnce([{ id: 'user-1', githubUsername: 'octocat' }]) // user lookup
      .mockResolvedValueOnce([{ id: 'purchase-1', status: 'invite_sent' }]); // existing purchase

    await expect(service.checkout('user-1', 'listing-1')).rejects.toThrow(ConflictException);
    expect(mockStripe.createCheckoutSession).not.toHaveBeenCalled();
  });

  it('creates a pending purchase, a Stripe session, and stores the session id', async () => {
    mockDb.limit
      .mockResolvedValueOnce([listing]) // listing lookup
      .mockResolvedValueOnce([{ id: 'user-1', githubUsername: 'octocat' }]) // user lookup
      .mockResolvedValueOnce([]); // no existing purchase
    mockDb.returning.mockResolvedValueOnce([{ id: 'purchase-1' }]); // insert
    mockStripe.createCheckoutSession.mockResolvedValueOnce({
      id: 'cs_test_1',
      url: 'https://checkout.stripe.com/c/cs_test_1',
    });

    const result = await service.checkout('user-1', 'listing-1', 'octocat');

    expect(mockStripe.createCheckoutSession).toHaveBeenCalledWith(
      expect.objectContaining({
        purchaseId: 'purchase-1',
        title: 'Postgres Disk Full',
        amountCents: 2900,
        currency: 'usd',
      }),
    );
    // Session id persisted on the purchase row.
    expect(mockDb.set).toHaveBeenCalledWith({
      stripeSessionId: 'cs_test_1',
      amountCents: 2900,
    });
    expect(mockDb.set).toHaveBeenCalledWith({ githubUsername: 'octocat' });
    expect(mockDb.values).toHaveBeenCalledWith({
      userId: 'user-1',
      listingId: 'listing-1',
      amountCents: 2900,
    });
    expect(result).toEqual({ url: 'https://checkout.stripe.com/c/cs_test_1' });
  });

  it('reuses an existing pending purchase instead of inserting a second row', async () => {
    mockDb.limit
      .mockResolvedValueOnce([listing]) // listing lookup
      .mockResolvedValueOnce([{ id: 'user-1', githubUsername: 'octocat' }]) // user lookup
      .mockResolvedValueOnce([{ id: 'purchase-1', status: 'pending', stripeSessionId: 'cs_old' }]); // existing pending
    mockStripe.createCheckoutSession.mockResolvedValueOnce({
      id: 'cs_test_2',
      url: 'https://checkout.stripe.com/c/cs_test_2',
    });

    const result = await service.checkout('user-1', 'listing-1');

    expect(mockDb.insert).not.toHaveBeenCalled();
    expect(mockStripe.expireCheckoutSession).toHaveBeenCalledWith('cs_old');
    expect(mockDb.set).toHaveBeenCalledWith({
      stripeSessionId: 'cs_test_2',
      amountCents: 2900,
    });
    expect(result.url).toBe('https://checkout.stripe.com/c/cs_test_2');
  });

  it('still checks out when expiring the stale session fails', async () => {
    mockDb.limit
      .mockResolvedValueOnce([listing]) // listing lookup
      .mockResolvedValueOnce([{ id: 'user-1', githubUsername: 'octocat' }]) // user lookup
      .mockResolvedValueOnce([{ id: 'purchase-1', status: 'pending', stripeSessionId: 'cs_old' }]);
    mockStripe.expireCheckoutSession.mockRejectedValueOnce(new Error('already expired'));
    mockStripe.createCheckoutSession.mockResolvedValueOnce({
      id: 'cs_test_3',
      url: 'https://checkout.stripe.com/c/cs_test_3',
    });

    const result = await service.checkout('user-1', 'listing-1');

    expect(result.url).toBe('https://checkout.stripe.com/c/cs_test_3');
  });
});

describe('PurchasesService.handleWebhook', () => {
  let service: PurchasesService;

  beforeEach(async () => {
    resetChains();
    service = await makeService();
  });

  const completedEvent = {
    type: 'checkout.session.completed',
    data: { object: { payment_status: 'paid', metadata: { purchaseId: 'purchase-1' } } },
  };
  const paidRow = { id: 'purchase-1', userId: 'user-1', listingId: 'listing-1', status: 'paid' };

  it('throws 400 on an invalid signature and touches nothing', async () => {
    mockStripe.constructEvent.mockImplementation(() => {
      throw new Error('bad signature');
    });

    await expect(service.handleWebhook(Buffer.from('{}'), 'bad')).rejects.toThrow(
      BadRequestException,
    );
    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it('completed event: pending → paid → invite_sent, GitHub invited with pull access', async () => {
    mockStripe.constructEvent.mockReturnValue(completedEvent);
    mockDb.returning.mockResolvedValueOnce([paidRow]); // pending → paid transition
    mockDb.limit
      .mockResolvedValueOnce([{ id: 'user-1', githubUsername: 'octocat' }]) // user lookup
      .mockResolvedValueOnce([listing]); // listing lookup
    mockGitHub.addRepoCollaborator.mockResolvedValueOnce(undefined);

    await service.handleWebhook(Buffer.from(JSON.stringify(completedEvent)), 'valid');

    expect(mockGitHub.addRepoCollaborator).toHaveBeenCalledWith(
      'test-owner',
      'scenario-pg-disk-full',
      'octocat',
    );
    expect(mockDb.set).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'invite_sent', invitedAt: expect.any(Date) }),
    );
  });

  it('webhook replay: no pending row matched → no GitHub call', async () => {
    mockStripe.constructEvent.mockReturnValue(completedEvent);
    mockDb.returning.mockResolvedValueOnce([]); // already processed

    await service.handleWebhook(Buffer.from(JSON.stringify(completedEvent)), 'valid');

    expect(mockGitHub.addRepoCollaborator).not.toHaveBeenCalled();
  });

  it('GitHub invite failure marks the purchase invite_failed', async () => {
    mockStripe.constructEvent.mockReturnValue(completedEvent);
    mockDb.returning.mockResolvedValueOnce([paidRow]);
    mockDb.limit
      .mockResolvedValueOnce([{ id: 'user-1', githubUsername: 'octocat' }])
      .mockResolvedValueOnce([listing]);
    mockGitHub.addRepoCollaborator.mockRejectedValueOnce(new Error('404 user not found'));

    await service.handleWebhook(Buffer.from(JSON.stringify(completedEvent)), 'valid');

    expect(mockDb.set).toHaveBeenCalledWith({ status: 'invite_failed' });
  });

  it('ignores a completed session whose payment has not settled', async () => {
    mockStripe.constructEvent.mockReturnValue({
      type: 'checkout.session.completed',
      data: { object: { payment_status: 'unpaid', metadata: { purchaseId: 'purchase-1' } } },
    });

    await service.handleWebhook(Buffer.from('{}'), 'valid');

    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it('ignores a completed session without a purchaseId in metadata', async () => {
    mockStripe.constructEvent.mockReturnValue({
      type: 'checkout.session.completed',
      data: { object: { payment_status: 'paid', metadata: {} } },
    });

    await service.handleWebhook(Buffer.from('{}'), 'valid');

    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it('marks invite_failed when the user has no github username', async () => {
    mockStripe.constructEvent.mockReturnValue(completedEvent);
    mockDb.returning.mockResolvedValueOnce([paidRow]);
    mockDb.limit
      .mockResolvedValueOnce([{ id: 'user-1', githubUsername: null }]) // user lookup
      .mockResolvedValueOnce([listing]); // listing lookup

    await service.handleWebhook(Buffer.from(JSON.stringify(completedEvent)), 'valid');

    expect(mockGitHub.addRepoCollaborator).not.toHaveBeenCalled();
    expect(mockDb.set).toHaveBeenCalledWith({ status: 'invite_failed' });
  });

  it('ignores event types other than checkout.session.completed', async () => {
    mockStripe.constructEvent.mockReturnValue({ type: 'payment_intent.created', data: { object: {} } });

    await service.handleWebhook(Buffer.from('{}'), 'valid');

    expect(mockDb.update).not.toHaveBeenCalled();
  });
});

describe('PurchasesService.retryInvite', () => {
  let service: PurchasesService;

  beforeEach(async () => {
    resetChains();
    service = await makeService();
  });

  it("404 when the purchase is not the caller's", async () => {
    mockDb.limit.mockResolvedValueOnce([]); // ownership lookup

    await expect(service.retryInvite('user-2', 'purchase-1')).rejects.toThrow(NotFoundException);
  });

  it('400 when the purchase is not in an invitable state', async () => {
    mockDb.limit.mockResolvedValueOnce([
      { id: 'purchase-1', userId: 'user-1', listingId: 'listing-1', status: 'pending' },
    ]);

    await expect(service.retryInvite('user-1', 'purchase-1')).rejects.toThrow(
      BadRequestException,
    );
  });

  it('re-invites on invite_failed and returns the new status', async () => {
    mockDb.limit
      .mockResolvedValueOnce([
        { id: 'purchase-1', userId: 'user-1', listingId: 'listing-1', status: 'invite_failed' },
      ]) // ownership lookup
      .mockResolvedValueOnce([{ id: 'user-1', githubUsername: 'octocat' }]) // user lookup
      .mockResolvedValueOnce([listing]) // listing lookup
      .mockResolvedValueOnce([{ id: 'purchase-1', status: 'invite_sent' }]); // re-read
    mockGitHub.addRepoCollaborator.mockResolvedValueOnce(undefined);

    const result = await service.retryInvite('user-1', 'purchase-1');

    expect(mockGitHub.addRepoCollaborator).toHaveBeenCalledWith(
      'test-owner',
      'scenario-pg-disk-full',
      'octocat',
    );
    expect(result).toEqual({ status: 'invite_sent' });
  });

  it('recovers a paid-stuck purchase (crash between paid and invite)', async () => {
    mockDb.limit
      .mockResolvedValueOnce([
        { id: 'purchase-1', userId: 'user-1', listingId: 'listing-1', status: 'paid' },
      ]) // ownership lookup
      .mockResolvedValueOnce([{ id: 'user-1', githubUsername: 'octocat' }]) // user lookup
      .mockResolvedValueOnce([listing]) // listing lookup
      .mockResolvedValueOnce([{ id: 'purchase-1', status: 'invite_sent' }]); // re-read
    mockGitHub.addRepoCollaborator.mockResolvedValueOnce(undefined);

    const result = await service.retryInvite('user-1', 'purchase-1');

    expect(result).toEqual({ status: 'invite_sent' });
  });
});

describe('PurchasesService.mine', () => {
  let service: PurchasesService;

  beforeEach(async () => {
    resetChains();
    service = await makeService();
  });

  it('returns purchases joined to listings, repoUrl only when invite_sent', async () => {
    mockDb.where.mockResolvedValueOnce([
      {
        id: 'purchase-1',
        status: 'invite_sent',
        createdAt: new Date('2026-07-15'),
        listingTitle: 'Postgres Disk Full',
        listingSlug: 'pg-disk-full',
        contentRepo: 'scenario-pg-disk-full',
      },
      {
        id: 'purchase-2',
        status: 'invite_failed',
        createdAt: new Date('2026-07-15'),
        listingTitle: 'LLM Auth Outage',
        listingSlug: 'llm-auth-outage',
        contentRepo: 'scenario-llm-auth',
      },
    ]);

    const result = await service.mine('user-1');

    expect(result[0].repoUrl).toBe('https://github.com/test-owner/scenario-pg-disk-full');
    expect(result[1].repoUrl).toBeNull();
    // contentRepo itself is not leaked; only the derived repoUrl is.
    expect(result[0]).not.toHaveProperty('contentRepo');
  });
});
