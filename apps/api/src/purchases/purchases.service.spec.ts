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
