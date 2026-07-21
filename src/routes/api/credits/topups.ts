import { createFileRoute } from '@tanstack/react-router';

import { getAuth } from '@/core/auth';
import { getAllConfigs } from '@/modules/config/service';
import { getAvailablePaymentProviders } from '@/modules/payment/service';
import { parseTopupProducts } from '@/modules/payment/topup-catalog';
import { respData, respErr } from '@/lib/resp';

async function GET({ request }: { request: Request }) {
  try {
    const auth = getAuth();
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session?.user) return respErr('Unauthorized');

    const configs = await getAllConfigs({ fresh: true });
    const enabled = (configs.credit_topup_enabled ?? 'true') === 'true';
    const catalog = parseTopupProducts(configs.credit_topup_products);
    const payment = await getAvailablePaymentProviders(configs);

    return respData({
      enabled,
      products: enabled && !catalog.error ? catalog.products : [],
      providers: payment.providers,
      defaultProvider: payment.defaultProvider,
      selectPayment: configs.select_payment_enabled === 'true',
      unavailableReason: !enabled
        ? 'topup_disabled'
        : catalog.error
          ? 'catalog_invalid'
          : payment.providers.length === 0
            ? 'payment_not_configured'
            : null,
    });
  } catch (error: any) {
    return respErr(error.message || 'Failed to load top-up products');
  }
}

export const Route = createFileRoute('/api/credits/topups')({
  server: {
    handlers: { GET },
  },
});
