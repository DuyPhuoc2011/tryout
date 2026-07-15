import { StripeService } from './stripe.service';

const mockSessionsCreate = jest.fn();
const mockConstructEvent = jest.fn();

jest.mock('stripe', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    checkout: { sessions: { create: mockSessionsCreate } },
    webhooks: { constructEvent: mockConstructEvent },
  })),
}));

describe('StripeService', () => {
  let service: StripeService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new StripeService('sk_test_fake', 'whsec_fake');
  });

  it('creates a one-time payment checkout session with price from params', async () => {
    mockSessionsCreate.mockResolvedValue({
      id: 'cs_test_1',
      url: 'https://checkout.stripe.com/c/cs_test_1',
    });

    const result = await service.createCheckoutSession({
      purchaseId: 'purchase-1',
      title: 'Postgres Disk Full',
      amountCents: 2900,
      currency: 'usd',
      successUrl: 'http://localhost:3000/purchase/success',
      cancelUrl: 'http://localhost:3000/purchase/cancelled',
    });

    expect(mockSessionsCreate).toHaveBeenCalledWith({
      mode: 'payment',
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: 'usd',
            unit_amount: 2900,
            product_data: { name: 'Postgres Disk Full' },
          },
        },
      ],
      metadata: { purchaseId: 'purchase-1' },
      success_url: 'http://localhost:3000/purchase/success',
      cancel_url: 'http://localhost:3000/purchase/cancelled',
    });
    expect(result).toEqual({ id: 'cs_test_1', url: 'https://checkout.stripe.com/c/cs_test_1' });
  });

  it('verifies webhook events with the configured secret', () => {
    const payload = Buffer.from('{"type":"checkout.session.completed"}');
    mockConstructEvent.mockReturnValue({ type: 'checkout.session.completed' });

    const event = service.constructEvent(payload, 'sig-header');

    expect(mockConstructEvent).toHaveBeenCalledWith(payload, 'sig-header', 'whsec_fake');
    expect(event).toEqual({ type: 'checkout.session.completed' });
  });
});
