import assert from 'node:assert/strict';

import { StripeProvider } from './stripe';
import { PaymentEventType, PaymentStatus } from './types';

const provider = new StripeProvider({
  secretKey: 'sk_test_placeholder',
  publishableKey: 'pk_test_placeholder',
  signingSecret: 'whsec_test_placeholder',
});

const checkoutSession = {
  id: 'cs_test_webhook',
  object: 'checkout.session',
  status: 'complete',
  payment_status: 'paid',
  amount_total: 1000,
  currency: 'cny',
  created: 1_700_000_000,
  discounts: [],
  metadata: { order_no: 'ORD_TEST_WEBHOOK' },
  total_details: { amount_discount: 0 },
};

let asyncVerifierCalled = false;
const stripeClient = (provider as any).client;
stripeClient.webhooks.constructEvent = () => {
  throw new Error('synchronous webhook verification must not be used');
};
stripeClient.webhooks.constructEventAsync = async () => {
  asyncVerifierCalled = true;
  return {
    id: 'evt_test_webhook',
    object: 'event',
    type: 'checkout.session.completed',
    data: { object: checkoutSession },
  };
};

const event = await provider.getPaymentEvent({
  req: new Request('https://hicode.run/api/payment/notify/stripe', {
    method: 'POST',
    headers: { 'stripe-signature': 'test-signature' },
    body: JSON.stringify(checkoutSession),
  }),
});

assert.equal(asyncVerifierCalled, true);
assert.equal(event.eventType, PaymentEventType.CHECKOUT_SUCCESS);
assert.equal(event.paymentSession?.paymentStatus, PaymentStatus.SUCCESS);
assert.equal(event.paymentSession?.paymentInfo.paymentAmount, 1000);
assert.equal(event.paymentSession?.metadata?.order_no, 'ORD_TEST_WEBHOOK');

console.log('stripe.test.ts OK');
