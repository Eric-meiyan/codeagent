import { PaymentType } from '@/core/payment/types';
import type { PricingProduct } from '@/config/pricing';

export type TopupProduct = PricingProduct & {
  kind: 'topup';
  creditsValidDays: number;
};

type RawTopupProduct = {
  id?: unknown;
  name?: unknown;
  description?: unknown;
  priceInCents?: unknown;
  currency?: unknown;
  credits?: unknown;
  creditsValidDays?: unknown;
  enabled?: unknown;
};

export const DEFAULT_TOPUP_PRODUCTS: TopupProduct[] = [
  {
    kind: 'topup',
    productId: 'topup_1000',
    productName: '1,000 Credits',
    planName: '1,000 Credits',
    description: 'Add 1,000 credits to your balance',
    type: PaymentType.ONE_TIME,
    priceInCents: 1000,
    currency: 'cny',
    credits: 1000,
    creditsValidDays: 365,
  },
  {
    kind: 'topup',
    productId: 'topup_5000',
    productName: '5,000 Credits',
    planName: '5,000 Credits',
    description: 'Add 5,000 credits to your balance',
    type: PaymentType.ONE_TIME,
    priceInCents: 5000,
    currency: 'cny',
    credits: 5000,
    creditsValidDays: 365,
  },
  {
    kind: 'topup',
    productId: 'topup_10000',
    productName: '10,000 Credits',
    planName: '10,000 Credits',
    description: 'Add 10,000 credits to your balance',
    type: PaymentType.ONE_TIME,
    priceInCents: 10000,
    currency: 'cny',
    credits: 10000,
    creditsValidDays: 365,
  },
];

export const DEFAULT_TOPUP_PRODUCTS_JSON = JSON.stringify(
  DEFAULT_TOPUP_PRODUCTS.map((product) => ({
    id: product.productId,
    name: product.productName,
    description: product.description,
    priceInCents: product.priceInCents,
    currency: product.currency,
    credits: product.credits,
    creditsValidDays: product.creditsValidDays,
    enabled: true,
  })),
  null,
  2
);

export function parseTopupProducts(raw?: string): {
  products: TopupProduct[];
  error?: string;
} {
  if (!raw?.trim()) {
    return { products: DEFAULT_TOPUP_PRODUCTS };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { products: [], error: 'Top-up products must be valid JSON' };
  }

  if (!Array.isArray(parsed) || parsed.length === 0 || parsed.length > 20) {
    return {
      products: [],
      error: 'Top-up products must contain between 1 and 20 items',
    };
  }

  const products: TopupProduct[] = [];
  const ids = new Set<string>();

  for (const [index, value] of parsed.entries()) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return { products: [], error: `Top-up product ${index + 1} is invalid` };
    }

    const item = value as RawTopupProduct;
    if (item.enabled === false) continue;

    const id = text(item.id);
    const name = text(item.name);
    const description = text(item.description) || name;
    const currency = text(item.currency).toLowerCase();
    const priceInCents = positiveInteger(item.priceInCents);
    const credits = positiveInteger(item.credits);
    const creditsValidDays = nonNegativeInteger(item.creditsValidDays, 365);

    if (!/^topup_[a-z0-9_-]{1,50}$/.test(id)) {
      return {
        products: [],
        error: `Top-up product ${index + 1} must use an id beginning with topup_`,
      };
    }
    if (ids.has(id)) {
      return { products: [], error: `Duplicate top-up product id: ${id}` };
    }
    if (!name || name.length > 80) {
      return {
        products: [],
        error: `Top-up product ${index + 1} needs a name`,
      };
    }
    if (!/^[a-z]{3}$/.test(currency)) {
      return {
        products: [],
        error: `Top-up product ${index + 1} needs a 3-letter currency`,
      };
    }
    if (!priceInCents || priceInCents > 100_000_000) {
      return {
        products: [],
        error: `Top-up product ${index + 1} has an invalid price`,
      };
    }
    if (!credits || credits > 1_000_000_000) {
      return {
        products: [],
        error: `Top-up product ${index + 1} has an invalid credit amount`,
      };
    }
    if (creditsValidDays < 0 || creditsValidDays > 3650) {
      return {
        products: [],
        error: `Top-up product ${index + 1} has an invalid validity period`,
      };
    }

    ids.add(id);
    products.push({
      kind: 'topup',
      productId: id,
      productName: name,
      planName: name,
      description: description.slice(0, 200),
      type: PaymentType.ONE_TIME,
      priceInCents,
      currency,
      credits,
      creditsValidDays,
    });
  }

  if (products.length === 0) {
    return {
      products: [],
      error: 'At least one top-up product must be enabled',
    };
  }

  return { products };
}

export function listTopupProducts(
  configs: Record<string, string>
): TopupProduct[] {
  if ((configs.credit_topup_enabled ?? 'true') !== 'true') return [];
  return parseTopupProducts(configs.credit_topup_products).products;
}

export function getTopupProduct(
  configs: Record<string, string>,
  productId: string
): TopupProduct | null {
  return (
    listTopupProducts(configs).find(
      (product) => product.productId === productId
    ) ?? null
  );
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function positiveInteger(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 0;
}

function nonNegativeInteger(value: unknown, fallback: number): number {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : -1;
}
