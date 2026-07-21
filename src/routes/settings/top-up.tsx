import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { AlertCircle, ArrowLeft, Coins, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

import { tDynamic } from '@/core/i18n/dynamic';
import { m } from '@/core/i18n/messages';
import { Link } from '@/core/i18n/navigation';
import { ApiError, apiGet, apiPost } from '@/lib/api-client';
import {
  PaymentProviderModal,
  type PaymentProvider,
} from '@/components/payment-provider-modal';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

type TopupProduct = {
  productId: string;
  productName: string;
  description: string;
  priceInCents: number;
  currency: string;
  credits: number;
  creditsValidDays: number;
};

type TopupCatalog = {
  enabled: boolean;
  products: TopupProduct[];
  providers: string[];
  defaultProvider: string | null;
  selectPayment: boolean;
  unavailableReason:
    | 'catalog_invalid'
    | 'payment_not_configured'
    | 'topup_disabled'
    | null;
};

type CheckoutInput = {
  product: TopupProduct;
  provider: PaymentProvider;
};

const PAYMENT_PROVIDERS: PaymentProvider[] = [
  'stripe',
  'creem',
  'paypal',
  'alipay',
  'wechat',
];

function TopupPage() {
  const queryClient = useQueryClient();
  const [selectedProduct, setSelectedProduct] = useState<TopupProduct | null>(
    null
  );
  const [providerModalOpen, setProviderModalOpen] = useState(false);

  const balanceQuery = useQuery({
    queryKey: ['user-credits', 'balance'],
    queryFn: () => apiGet<{ balance: number }>('/api/credits'),
  });
  const catalogQuery = useQuery({
    queryKey: ['credit-topups'],
    queryFn: () => apiGet<TopupCatalog>('/api/credits/topups'),
  });

  const providers = useMemo(
    () =>
      (catalogQuery.data?.providers || []).filter(
        (provider): provider is PaymentProvider =>
          PAYMENT_PROVIDERS.includes(provider as PaymentProvider)
      ),
    [catalogQuery.data?.providers]
  );

  const checkoutMutation = useMutation({
    mutationFn: ({ product, provider }: CheckoutInput) =>
      apiPost<{ checkout_url?: string }>('/api/payment/checkout', {
        product_id: product.productId,
        payment_provider: provider,
        redirect: '/settings/top-up?success=1',
      }),
    onSuccess: (data) => {
      if (!data.checkout_url) {
        toast.error(m['settings.topup.checkout_failed']());
        return;
      }
      window.location.assign(data.checkout_url);
    },
    onError: (error) => {
      toast.error(
        error instanceof ApiError && error.message
          ? error.message
          : m['settings.topup.checkout_failed']()
      );
    },
  });

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('success') === '1') {
      toast.success(m['settings.topup.success']());
      queryClient.invalidateQueries({ queryKey: ['user-credits'] });
      queryClient.invalidateQueries({ queryKey: ['user-payments'] });
      window.history.replaceState({}, '', window.location.pathname);
    } else if (params.get('canceled') === '1') {
      toast.info(m['settings.topup.canceled']());
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, [queryClient]);

  function beginCheckout(product: TopupProduct) {
    if (providers.length === 0) return;

    const defaultProvider = catalogQuery.data?.defaultProvider;
    const preferred = providers.includes(defaultProvider as PaymentProvider)
      ? (defaultProvider as PaymentProvider)
      : providers[0];

    if (catalogQuery.data?.selectPayment && providers.length > 1) {
      setSelectedProduct(product);
      setProviderModalOpen(true);
      return;
    }

    checkoutMutation.mutate({ product, provider: preferred });
  }

  function selectProvider(provider: PaymentProvider) {
    if (!selectedProduct) return;
    setProviderModalOpen(false);
    checkoutMutation.mutate({ product: selectedProduct, provider });
  }

  const catalog = catalogQuery.data;
  const unavailable = catalog?.unavailableReason;

  return (
    <div className="space-y-6 p-6">
      <div className="space-y-3">
        <Link
          href="/settings/credits"
          className={buttonVariants({ variant: 'ghost', size: 'sm' })}
        >
          <ArrowLeft className="size-4" />
          {m['settings.topup.back']()}
        </Link>
        <div>
          <h1 className="text-2xl font-bold">{m['settings.topup.title']()}</h1>
          <p className="text-muted-foreground">
            {m['settings.topup.description']()}
          </p>
        </div>
      </div>

      <Card className="max-w-md rounded-lg">
        <CardHeader>
          <CardTitle>{m['settings.credits.balance']()}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-3xl font-bold tabular-nums">
            {balanceQuery.isPending
              ? '…'
              : (balanceQuery.data?.balance ?? 0).toLocaleString()}
          </p>
        </CardContent>
      </Card>

      {unavailable && (
        <div className="border-border bg-muted/30 flex items-start gap-3 rounded-lg border p-4">
          <AlertCircle className="text-muted-foreground mt-0.5 size-5 shrink-0" />
          <div>
            <p className="font-medium">
              {m['settings.topup.unavailable_title']()}
            </p>
            <p className="text-muted-foreground text-sm">
              {tDynamic(`settings.topup.unavailable_${unavailable}`)}
            </p>
          </div>
        </div>
      )}

      {catalogQuery.isPending ? (
        <div className="text-muted-foreground flex items-center gap-2 py-10">
          <Loader2 className="size-4 animate-spin" />
          {m['settings.topup.loading']()}
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {(catalog?.products || []).map((product) => {
            const loading =
              checkoutMutation.isPending &&
              checkoutMutation.variables?.product.productId ===
                product.productId;
            return (
              <Card key={product.productId} className="rounded-lg">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-lg">
                    <Coins className="text-primary size-5" />
                    {product.credits.toLocaleString()}{' '}
                    {m['settings.topup.credits']()}
                  </CardTitle>
                  <p className="text-muted-foreground text-sm">
                    {product.creditsValidDays > 0
                      ? m['settings.topup.valid_days']({
                          days: String(product.creditsValidDays),
                        })
                      : m['settings.topup.never_expires']()}
                  </p>
                </CardHeader>
                <CardContent className="space-y-5">
                  <p className="text-3xl font-bold tabular-nums">
                    {formatPrice(product.priceInCents, product.currency)}
                  </p>
                  <Button
                    className="w-full"
                    disabled={
                      providers.length === 0 || checkoutMutation.isPending
                    }
                    onClick={() => beginCheckout(product)}
                  >
                    {loading && <Loader2 className="size-4 animate-spin" />}
                    {loading
                      ? m['common.pricing.processing']()
                      : m['settings.topup.purchase']()}
                  </Button>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <PaymentProviderModal
        open={providerModalOpen}
        onOpenChange={setProviderModalOpen}
        providers={providers}
        loadingProvider={
          checkoutMutation.isPending
            ? checkoutMutation.variables?.provider
            : null
        }
        onSelect={selectProvider}
        planName={selectedProduct?.productName}
        price={
          selectedProduct
            ? formatPrice(
                selectedProduct.priceInCents,
                selectedProduct.currency
              )
            : undefined
        }
      />
    </div>
  );
}

function formatPrice(amount: number, currency: string) {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: currency.toUpperCase(),
  }).format(amount / 100);
}

export const Route = createFileRoute('/settings/top-up')({
  component: TopupPage,
});
