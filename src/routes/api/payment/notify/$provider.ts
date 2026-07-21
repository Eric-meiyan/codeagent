import { createFileRoute } from '@tanstack/react-router';

import { handleWebhook } from '@/modules/payment/service';
import { respOk } from '@/lib/resp';

export const Route = createFileRoute('/api/payment/notify/$provider')({
  server: {
    handlers: {
      // Pass the untouched Request through — webhook signature
      // verification needs the raw body.
      POST: async ({ request, params }) => {
        const { provider } = params;

        try {
          const event = await handleWebhook({ req: request, provider });

          console.log(`Payment event [${provider}]: ${event.eventType}`);

          // Alipay expects plain text "success"
          if (provider === 'alipay') {
            return new Response('success', {
              status: 200,
              headers: { 'Content-Type': 'text/plain' },
            });
          }

          // WeChat expects JSON { code, message }
          if (provider === 'wechat') {
            return Response.json({ code: 'SUCCESS', message: 'OK' });
          }

          return respOk();
        } catch (error: any) {
          console.error('webhook error:', error);

          if (provider === 'alipay') {
            return new Response('fail', {
              status: 200,
              headers: { 'Content-Type': 'text/plain' },
            });
          }

          const message = error?.message || 'Webhook handling failed';
          const isInvalidRequest =
            error?.type === 'StripeSignatureVerificationError' ||
            /invalid webhook|invalid .*signature|missing .*signature|timestamp outside/i.test(
              message
            );

          return Response.json(
            { code: -1, message: 'Webhook handling failed' },
            { status: isInvalidRequest ? 400 : 500 }
          );
        }
      },
    },
  },
});
