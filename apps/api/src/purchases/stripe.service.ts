import { Injectable } from '@nestjs/common';
import Stripe from 'stripe';

export interface CheckoutSessionParams {
  purchaseId: string;
  title: string;
  amountCents: number;
  currency: string;
  successUrl: string;
  cancelUrl: string;
}

export interface CheckoutSessionResult {
  id: string;
  url: string;
}

/** Thin wrapper around the Stripe SDK so callers and tests can mock one injectable. */
@Injectable()
export class StripeService {
  private readonly stripe: Stripe;

  constructor(
    secretKey: string,
    private readonly webhookSecret: string,
  ) {
    this.stripe = new Stripe(secretKey, { apiVersion: '2026-06-24.dahlia' });
  }

  async createCheckoutSession(params: CheckoutSessionParams): Promise<CheckoutSessionResult> {
    const session = await this.stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: params.currency,
            unit_amount: params.amountCents,
            product_data: { name: params.title },
          },
        },
      ],
      metadata: { purchaseId: params.purchaseId },
      success_url: params.successUrl,
      cancel_url: params.cancelUrl,
    });
    if (!session.url) {
      throw new Error('Stripe session created without a hosted checkout URL');
    }
    return { id: session.id, url: session.url };
  }

  /** Best-effort: expire a previously created (still open) checkout session. */
  async expireCheckoutSession(sessionId: string): Promise<void> {
    await this.stripe.checkout.sessions.expire(sessionId);
  }

  /** Throws if the signature does not match the raw payload. */
  constructEvent(payload: Buffer, signature: string): Stripe.Event {
    return this.stripe.webhooks.constructEvent(payload, signature, this.webhookSecret);
  }
}
