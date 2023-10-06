import { type AppController } from '@/app.ts';
import * as mixer from '@/mixer.ts';
import { Time } from '@/utils.ts';
import { paginated, paginationSchema } from '@/utils/web.ts';
import { toNotification } from '@/views/nostr-to-mastoapi.ts';

const notificationsController: AppController = async (c) => {
  const pubkey = c.get('pubkey')!;
  const { since, until } = paginationSchema.parse(c.req.query());

  const events = await mixer.getFilters(
    [{ kinds: [1], '#p': [pubkey], since, until }],
    { timeout: Time.seconds(3) },
  );

  const statuses = await Promise.all(events.map((event) => toNotification(event, pubkey)));
  return paginated(c, events, statuses);
};

export { notificationsController };
