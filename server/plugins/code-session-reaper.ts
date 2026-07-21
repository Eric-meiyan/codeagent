import { definePlugin } from 'nitro';
import { useNitroHooks } from 'nitro/app';

type ScheduledControllerLike = {
  cron: string;
  scheduledTime: number;
};

export default definePlugin(() => {
  const hooks = useNitroHooks();

  hooks.hook(
    'cloudflare:scheduled' as any,
    async ({ controller }: { controller: ScheduledControllerLike }) => {
      if (controller.cron !== '* * * * *') return;

      const { meterActiveSessions, suspendIdleSessions } =
        await import('@/modules/code/service');
      const { settleCollectibleBillingDebts } =
        await import('@/modules/code/billing');
      const now = new Date(controller.scheduledTime);
      const debts = await settleCollectibleBillingDebts();
      const billing = await meterActiveSessions(now);
      const reaper = await suspendIdleSessions(
        new Date(controller.scheduledTime)
      );
      console.info('[code-session-maintenance]', { debts, billing, reaper });
    }
  );
});
