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
      if (controller.cron !== '*/5 * * * *') return;

      const { suspendIdleSessions } = await import('@/modules/code/service');
      const result = await suspendIdleSessions(
        new Date(controller.scheduledTime)
      );
      console.info('[code-session-reaper]', result);
    }
  );
});
