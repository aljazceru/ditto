import { NKinds, NostrEvent, NSchema as n } from '@nostrify/nostrify';
import { Stickynotes } from '@soapbox/stickynotes';
import { Kysely, sql } from 'kysely';
import { LRUCache } from 'lru-cache';
import { z } from 'zod';

import { Conf } from '@/config.ts';
import { DittoTables } from '@/db/DittoTables.ts';
import { DittoPush } from '@/DittoPush.ts';
import { DittoEvent } from '@/interfaces/DittoEvent.ts';
import { pipelineEventsCounter, policyEventsCounter, webPushNotificationsCounter } from '@/metrics.ts';
import { RelayError } from '@/RelayError.ts';
import { AdminSigner } from '@/signers/AdminSigner.ts';
import { hydrateEvents } from '@/storages/hydrate.ts';
import { Storages } from '@/storages.ts';
import { eventAge, parseNip05, Time } from '@/utils.ts';
import { getAmount } from '@/utils/bolt11.ts';
import { detectLanguage } from '@/utils/language.ts';
import { nip05Cache } from '@/utils/nip05.ts';
import { purifyEvent } from '@/utils/purify.ts';
import { updateStats } from '@/utils/stats.ts';
import { getTagSet } from '@/utils/tags.ts';
import { renderWebPushNotification } from '@/views/mastodon/push.ts';
import { policyWorker } from '@/workers/policy.ts';
import { verifyEventWorker } from '@/workers/verify.ts';

const console = new Stickynotes('ditto:pipeline');

/**
 * Common pipeline function to process (and maybe store) events.
 * It is idempotent, so it can be called multiple times for the same event.
 */
async function handleEvent(event: DittoEvent, signal: AbortSignal): Promise<void> {
  // Integer max value for Postgres. TODO: switch to a bigint in 2038.
  if (event.created_at >= 2_147_483_647) {
    throw new RelayError('invalid', 'event too far in the future');
  }
  // Integer max value for Postgres.
  if (event.kind >= 2_147_483_647) {
    throw new RelayError('invalid', 'event kind too large');
  }
  // The only point of ephemeral events is to stream them,
  // so throw an error if we're not even going to do that.
  if (NKinds.ephemeral(event.kind) && !isFresh(event)) {
    throw new RelayError('invalid', 'event too old');
  }
  // Block NIP-70 events, because we have no way to `AUTH`.
  if (isProtectedEvent(event)) {
    throw new RelayError('invalid', 'protected event');
  }
  // Validate the event's signature.
  if (!(await verifyEventWorker(event))) {
    throw new RelayError('invalid', 'invalid signature');
  }
  // Skip events that have been recently encountered.
  // We must do this after verifying the signature.
  if (encounterEvent(event)) {
    throw new RelayError('duplicate', 'already have this event');
  }

  // Log the event.
  console.info(`NostrEvent<${event.kind}> ${event.id}`);
  pipelineEventsCounter.inc({ kind: event.kind });

  // NIP-46 events get special treatment.
  // They are exempt from policies and other side-effects, and should be streamed out immediately.
  // If streaming fails, an error should be returned.
  if (event.kind === 24133) {
    await streamOut(event);
    return;
  }

  // Ensure the event doesn't violate the policy.
  if (event.pubkey !== Conf.pubkey) {
    await policyFilter(event, signal);
  }

  // Prepare the event for additional checks.
  // FIXME: This is kind of hacky. Should be reorganized to fetch only what's needed for each stage.
  await hydrateEvent(event, signal);

  // Ensure that the author is not banned.
  const n = getTagSet(event.user?.tags ?? [], 'n');
  if (n.has('disabled')) {
    throw new RelayError('blocked', 'author is blocked');
  }

  // Ephemeral events must throw if they are not streamed out.
  if (NKinds.ephemeral(event.kind)) {
    await Promise.all([
      streamOut(event),
      webPush(event),
    ]);
    return;
  }

  const kysely = await Storages.kysely();

  try {
    await storeEvent(purifyEvent(event), signal);
  } finally {
    // This needs to run in steps, and should not block the API from responding.
    Promise.allSettled([
      handleZaps(kysely, event),
      parseMetadata(event, signal),
      setLanguage(event),
      generateSetEvents(event),
    ])
      .then(() =>
        Promise.allSettled([
          streamOut(event),
          webPush(event),
        ])
      );
  }
}

async function policyFilter(event: NostrEvent, signal: AbortSignal): Promise<void> {
  const console = new Stickynotes('ditto:policy');

  try {
    const result = await policyWorker.call(event, signal);
    policyEventsCounter.inc({ ok: String(result[2]) });
    console.debug(JSON.stringify(result));
    RelayError.assert(result);
  } catch (e) {
    if (e instanceof RelayError) {
      throw e;
    } else {
      console.error(e);
      throw new RelayError('blocked', 'policy error');
    }
  }
}

const encounters = new LRUCache<string, true>({ max: 1000 });

/** Encounter the event, and return whether it has already been encountered. */
function encounterEvent(event: NostrEvent): boolean {
  const encountered = !!encounters.get(event.id);
  if (!encountered) {
    encounters.set(event.id, true);
  }
  return encountered;
}

/** Check whether the event has a NIP-70 `-` tag. */
function isProtectedEvent(event: NostrEvent): boolean {
  return event.tags.some(([name]) => name === '-');
}

/** Hydrate the event with the user, if applicable. */
async function hydrateEvent(event: DittoEvent, signal: AbortSignal): Promise<void> {
  await hydrateEvents({ events: [event], store: await Storages.db(), signal });

  const kysely = await Storages.kysely();
  const domain = await kysely
    .selectFrom('pubkey_domains')
    .select('domain')
    .where('pubkey', '=', event.pubkey)
    .executeTakeFirst();

  event.author_domain = domain?.domain;
}

/** Maybe store the event, if eligible. */
async function storeEvent(event: NostrEvent, signal?: AbortSignal): Promise<undefined> {
  if (NKinds.ephemeral(event.kind)) return;
  const store = await Storages.db();

  try {
    await store.transaction(async (store, kysely) => {
      await updateStats({ event, store, kysely });
      await store.event(event, { signal });
    });
  } catch (e) {
    // If the failure is only because of updateStats (which runs first), insert the event anyway.
    // We can't catch this in the transaction because the error aborts the transaction on the Postgres side.
    if (e instanceof Error && e.message.includes('event_stats' satisfies keyof DittoTables)) {
      await store.event(event, { signal });
    } else {
      throw e;
    }
  }
}

/** Parse kind 0 metadata and track indexes in the database. */
async function parseMetadata(event: NostrEvent, signal: AbortSignal): Promise<void> {
  if (event.kind !== 0) return;

  // Parse metadata.
  const metadata = n.json().pipe(n.metadata()).catch({}).safeParse(event.content);
  if (!metadata.success) return;

  const kysely = await Storages.kysely();

  // Get nip05.
  const { name, nip05 } = metadata.data;
  const result = nip05 ? await nip05Cache.fetch(nip05, { signal }).catch(() => undefined) : undefined;

  // Populate author_search.
  try {
    const search = result?.pubkey === event.pubkey ? [name, nip05].filter(Boolean).join(' ').trim() : name ?? '';

    if (search) {
      await kysely.insertInto('author_stats')
        .values({ pubkey: event.pubkey, search, followers_count: 0, following_count: 0, notes_count: 0 })
        .onConflict((oc) => oc.column('pubkey').doUpdateSet({ search }))
        .execute();
    }
  } catch {
    // do nothing
  }

  if (nip05 && result && result.pubkey === event.pubkey) {
    // Track pubkey domain.
    try {
      const { domain } = parseNip05(nip05);

      await sql`
      INSERT INTO pubkey_domains (pubkey, domain, last_updated_at)
      VALUES (${event.pubkey}, ${domain}, ${event.created_at})
      ON CONFLICT(pubkey) DO UPDATE SET
        domain = excluded.domain,
        last_updated_at = excluded.last_updated_at
      WHERE excluded.last_updated_at > pubkey_domains.last_updated_at
      `.execute(kysely);
    } catch (_e) {
      // do nothing
    }
  }
}

/** Update the event in the database and set its language. */
async function setLanguage(event: NostrEvent): Promise<void> {
  if (event.kind !== 1) return;

  const language = detectLanguage(event.content, 0.90);
  if (!language) return;

  const kysely = await Storages.kysely();
  try {
    await kysely.updateTable('nostr_events')
      .set('language', language)
      .where('id', '=', event.id)
      .execute();
  } catch {
    // do nothing
  }
}

/** Determine if the event is being received in a timely manner. */
function isFresh(event: NostrEvent): boolean {
  return eventAge(event) < Time.minutes(1);
}

/** Distribute the event through active subscriptions. */
async function streamOut(event: NostrEvent): Promise<void> {
  if (!isFresh(event)) {
    throw new RelayError('invalid', 'event too old');
  }

  const pubsub = await Storages.pubsub();
  await pubsub.event(event);
}

async function webPush(event: NostrEvent): Promise<void> {
  if (!isFresh(event)) {
    throw new RelayError('invalid', 'event too old');
  }

  const kysely = await Storages.kysely();
  const pubkeys = getTagSet(event.tags, 'p');

  if (!pubkeys.size) {
    return;
  }

  const rows = await kysely
    .selectFrom('push_subscriptions')
    .selectAll()
    .where('pubkey', 'in', [...pubkeys])
    .execute();

  for (const row of rows) {
    const viewerPubkey = row.pubkey;

    if (viewerPubkey === event.pubkey) {
      continue; // Don't notify authors about their own events.
    }

    const message = await renderWebPushNotification(event, viewerPubkey);
    if (!message) {
      continue;
    }

    const subscription = {
      endpoint: row.endpoint,
      keys: {
        auth: row.auth,
        p256dh: row.p256dh,
      },
    };

    await DittoPush.push(subscription, message);
    webPushNotificationsCounter.inc({ type: message.notification_type });
  }
}

async function generateSetEvents(event: NostrEvent): Promise<void> {
  const tagsAdmin = event.tags.some(([name, value]) => ['p', 'P'].includes(name) && value === Conf.pubkey);

  if (event.kind === 1984 && tagsAdmin) {
    const signer = new AdminSigner();

    const rel = await signer.signEvent({
      kind: 30383,
      content: '',
      tags: [
        ['d', event.id],
        ['p', event.pubkey],
        ['k', '1984'],
        ['n', 'open'],
        ...[...getTagSet(event.tags, 'p')].map((pubkey) => ['P', pubkey]),
        ...[...getTagSet(event.tags, 'e')].map((pubkey) => ['e', pubkey]),
      ],
      created_at: Math.floor(Date.now() / 1000),
    });

    await handleEvent(rel, AbortSignal.timeout(1000));
  }

  if (event.kind === 3036 && tagsAdmin) {
    const signer = new AdminSigner();

    const rel = await signer.signEvent({
      kind: 30383,
      content: '',
      tags: [
        ['d', event.id],
        ['p', event.pubkey],
        ['k', '3036'],
        ['n', 'pending'],
      ],
      created_at: Math.floor(Date.now() / 1000),
    });

    await handleEvent(rel, AbortSignal.timeout(1000));
  }
}

/** Stores the event in the 'event_zaps' table */
async function handleZaps(kysely: Kysely<DittoTables>, event: NostrEvent) {
  if (event.kind !== 9735) return;

  const zapRequestString = event?.tags?.find(([name]) => name === 'description')?.[1];
  if (!zapRequestString) return;
  const zapRequest = n.json().pipe(n.event()).optional().catch(undefined).parse(zapRequestString);
  if (!zapRequest) return;

  const amountSchema = z.coerce.number().int().nonnegative().catch(0);
  const amount_millisats = amountSchema.parse(getAmount(event?.tags.find(([name]) => name === 'bolt11')?.[1]));
  if (!amount_millisats || amount_millisats < 1) return;

  const zappedEventId = zapRequest.tags.find(([name]) => name === 'e')?.[1];
  if (!zappedEventId) return;

  try {
    await kysely.insertInto('event_zaps').values({
      receipt_id: event.id,
      target_event_id: zappedEventId,
      sender_pubkey: zapRequest.pubkey,
      amount_millisats,
      comment: zapRequest.content,
    }).execute();
  } catch {
    // receipt_id is unique, do nothing
  }
}

export { handleEvent, handleZaps };
