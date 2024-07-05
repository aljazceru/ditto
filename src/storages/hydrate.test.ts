import { MockRelay } from '@nostrify/nostrify/test';
import { assertEquals } from '@std/assert';

import { DittoEvent } from '@/interfaces/DittoEvent.ts';
import { hydrateEvents } from '@/storages/hydrate.ts';
import { createTestDB, eventFixture } from '@/test.ts';

Deno.test('hydrateEvents(): author --- WITHOUT stats', async () => {
  const relay = new MockRelay();
  await using db = await createTestDB('sqlite://:memory:');

  const event0 = await eventFixture('event-0');
  const event1 = await eventFixture('event-1');

  // Save events to database
  await relay.event(event0);
  await relay.event(event1);

  await hydrateEvents({
    events: [event1],
    store: relay,
    kysely: db.kysely,
  });

  const expectedEvent = { ...event1, author: event0 };
  assertEquals(event1, expectedEvent);
});

Deno.test('hydrateEvents(): repost --- WITHOUT stats', async () => {
  const relay = new MockRelay();
  await using db = await createTestDB('sqlite://:memory:');

  const event0madePost = await eventFixture('event-0-the-one-who-post-and-users-repost');
  const event0madeRepost = await eventFixture('event-0-the-one-who-repost');
  const event1reposted = await eventFixture('event-1-reposted');
  const event6 = await eventFixture('event-6');

  // Save events to database
  await relay.event(event0madePost);
  await relay.event(event0madeRepost);
  await relay.event(event1reposted);
  await relay.event(event6);

  await hydrateEvents({
    events: [event6],
    store: relay,
    kysely: db.kysely,
  });

  const expectedEvent6 = {
    ...event6,
    author: event0madeRepost,
    repost: { ...event1reposted, author: event0madePost },
  };
  assertEquals(event6, expectedEvent6);
});

Deno.test('hydrateEvents(): quote repost --- WITHOUT stats', async () => {
  const relay = new MockRelay();
  await using db = await createTestDB('sqlite://:memory:');

  const event0madeQuoteRepost = await eventFixture('event-0-the-one-who-quote-repost');
  const event0 = await eventFixture('event-0');
  const event1quoteRepost = await eventFixture('event-1-quote-repost');
  const event1willBeQuoteReposted = await eventFixture('event-1-that-will-be-quote-reposted');

  // Save events to database
  await relay.event(event0madeQuoteRepost);
  await relay.event(event0);
  await relay.event(event1quoteRepost);
  await relay.event(event1willBeQuoteReposted);

  await hydrateEvents({
    events: [event1quoteRepost],
    store: relay,
    kysely: db.kysely,
  });

  const expectedEvent1quoteRepost = {
    ...event1quoteRepost,
    author: event0madeQuoteRepost,
    quote: { ...event1willBeQuoteReposted, author: event0 },
  };

  assertEquals(event1quoteRepost, expectedEvent1quoteRepost);
});

Deno.test('hydrateEvents(): repost of quote repost --- WITHOUT stats', async () => {
  const relay = new MockRelay();
  await using db = await createTestDB('sqlite://:memory:');

  const author = await eventFixture('event-0-makes-repost-with-quote-repost');
  const event1 = await eventFixture('event-1-will-be-reposted-with-quote-repost');
  const event6 = await eventFixture('event-6-of-quote-repost');
  const event1quote = await eventFixture('event-1-quote-repost-will-be-reposted');

  // Save events to database
  await relay.event(author);
  await relay.event(event1);
  await relay.event(event1quote);
  await relay.event(event6);

  await hydrateEvents({
    events: [event6],
    store: relay,
    kysely: db.kysely,
  });

  const expectedEvent6 = {
    ...event6,
    author,
    repost: { ...event1quote, author, quote: { author, ...event1 } },
  };
  assertEquals(event6, expectedEvent6);
});

Deno.test('hydrateEvents(): report pubkey and post // kind 1984 --- WITHOUT stats', async () => {
  const relay = new MockRelay();
  await using db = await createTestDB('sqlite://:memory:');

  const authorDictator = await eventFixture('kind-0-dictator');
  const authorVictim = await eventFixture('kind-0-george-orwell');
  const reportEvent = await eventFixture('kind-1984-dictator-reports-george-orwell');
  const event1 = await eventFixture('kind-1-author-george-orwell');

  // Save events to database
  await relay.event(authorDictator);
  await relay.event(authorVictim);
  await relay.event(reportEvent);
  await relay.event(event1);

  await hydrateEvents({
    events: [reportEvent],
    store: relay,
    kysely: db.kysely,
  });

  const expectedEvent: DittoEvent = {
    ...reportEvent,
    author: authorDictator,
    reported_notes: [event1],
    reported_profile: authorVictim,
  };
  assertEquals(reportEvent, expectedEvent);
});
