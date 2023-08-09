import { Conf } from '@/config.ts';
import { insertEvent, isLocallyFollowed } from '@/db/events.ts';
import { RelayPool } from '@/deps.ts';
import { trends } from '@/trends.ts';
import { nostrDate, nostrNow } from '@/utils.ts';

import type { SignedEvent } from '@/event.ts';

const relay = new RelayPool([Conf.relay]);

// This file watches all events on your Ditto relay and triggers
// side-effects based on them. This can be used for things like
// notifications, trending hashtag tracking, etc.
relay.subscribe(
  [{ kinds: [1], since: nostrNow() }],
  [Conf.relay],
  handleEvent,
  undefined,
  undefined,
);

/** Handle events through the loopback pipeline. */
async function handleEvent(event: SignedEvent): Promise<void> {
  console.info('loopback event:', event.id);

  trackHashtags(event);

  if (await isLocallyFollowed(event.pubkey)) {
    insertEvent(event).catch(console.warn);
  }
}

/** Track whenever a hashtag is used, for processing trending tags. */
function trackHashtags(event: SignedEvent): void {
  const date = nostrDate(event.created_at);

  const tags = event.tags
    .filter((tag) => tag[0] === 't')
    .map((tag) => tag[1])
    .slice(0, 5);

  if (!tags.length) return;

  try {
    console.info('tracking tags:', tags);
    trends.addTagUsages(event.pubkey, tags, date);
  } catch (_e) {
    // do nothing
  }
}
