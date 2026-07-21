import assert from 'node:assert/strict';

import {
  DEFAULT_TOPUP_PRODUCTS,
  getTopupProduct,
  listTopupProducts,
  parseTopupProducts,
} from './topup-catalog';

assert.equal(
  parseTopupProducts().products.length,
  DEFAULT_TOPUP_PRODUCTS.length
);

const configured = JSON.stringify([
  {
    id: 'topup_launch',
    name: 'Launch Pack',
    priceInCents: 1999,
    currency: 'CNY',
    credits: 2500,
    creditsValidDays: 180,
    enabled: true,
  },
  {
    id: 'topup_hidden',
    name: 'Hidden Pack',
    priceInCents: 1,
    currency: 'cny',
    credits: 1,
    enabled: false,
  },
]);

const parsed = parseTopupProducts(configured);
assert.equal(parsed.error, undefined);
assert.deepEqual(parsed.products, [
  {
    kind: 'topup',
    productId: 'topup_launch',
    productName: 'Launch Pack',
    planName: 'Launch Pack',
    description: 'Launch Pack',
    type: 'one-time',
    priceInCents: 1999,
    currency: 'cny',
    credits: 2500,
    creditsValidDays: 180,
  },
]);

assert.equal(
  getTopupProduct(
    { credit_topup_enabled: 'true', credit_topup_products: configured },
    'topup_launch'
  )?.credits,
  2500
);
assert.deepEqual(
  listTopupProducts({
    credit_topup_enabled: 'false',
    credit_topup_products: configured,
  }),
  []
);
assert.match(
  parseTopupProducts('[{"id":"starter_monthly"}]').error || '',
  /beginning with topup_/
);
assert.match(parseTopupProducts('not-json').error || '', /valid JSON/);
assert.match(
  parseTopupProducts(
    '[{"id":"topup_invalid","name":"Invalid","priceInCents":100,"currency":"cny","credits":100,"creditsValidDays":-1}]'
  ).error || '',
  /validity period/
);

console.log('topup-catalog.test.ts OK');
