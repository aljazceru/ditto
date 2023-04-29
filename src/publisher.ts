import { getEventHash, getSignature } from '@/deps.ts';
import { type Event } from '@/event.ts';

import { pool } from './client.ts';
import { publishRelays } from './config.ts';

/** Publish an event to the Nostr relay. */
function publish(event: Event, privatekey: string, relays = publishRelays): void {
  event.id = getEventHash(event);
  event.sig = getSignature(event, privatekey);
  console.log('Publishing event', event);
  try {
    pool.publish(event, relays);
  } catch (e) {
    console.error(e);
  }
}

export default publish;