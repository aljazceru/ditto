import { type AuthorStatsRow, db, type DittoDB, type EventStatsRow } from '@/db.ts';
import * as eventsDB from '@/db/events.ts';
import { type Event, findReplyTag, type InsertQueryBuilder } from '@/deps.ts';

type AuthorStat = keyof Omit<AuthorStatsRow, 'pubkey'>;
type EventStat = keyof Omit<EventStatsRow, 'event_id'>;

type AuthorStatDiff = ['author_stats', pubkey: string, stat: AuthorStat, diff: number];
type EventStatDiff = ['event_stats', eventId: string, stat: EventStat, diff: number];
type StatDiff = AuthorStatDiff | EventStatDiff;

/** Store stats for the event in LMDB. */
async function updateStats<K extends number>(event: Event<K> & { prev?: Event<K> }) {
  const queries: InsertQueryBuilder<DittoDB, any, unknown>[] = [];

  // Kind 3 is a special case - replace the count with the new list.
  if (event.kind === 3) {
    await maybeSetPrev(event);
    queries.push(updateFollowingCountQuery(event as Event<3>));
  }

  const statDiffs = getStatsDiff(event);
  const pubkeyDiffs = statDiffs.filter(([table]) => table === 'author_stats') as AuthorStatDiff[];
  const eventDiffs = statDiffs.filter(([table]) => table === 'event_stats') as EventStatDiff[];

  if (pubkeyDiffs.length) queries.push(authorStatsQuery(pubkeyDiffs));
  if (eventDiffs.length) queries.push(eventStatsQuery(eventDiffs));

  if (queries.length) {
    await Promise.all(queries.map((query) => query.execute()));
  }
}

/** Calculate stats changes ahead of time so we can build an efficient query. */
function getStatsDiff<K extends number>(event: Event<K> & { prev?: Event<K> }): StatDiff[] {
  const statDiffs: StatDiff[] = [];

  const firstTaggedId = event.tags.find(([name]) => name === 'e')?.[1];
  const inReplyToId = findReplyTag(event as Event<1>)?.[1];

  switch (event.kind) {
    case 1:
      statDiffs.push(['author_stats', event.pubkey, 'notes_count', 1]);
      if (inReplyToId) {
        statDiffs.push(['event_stats', inReplyToId, 'replies_count', 1]);
      }
      break;
    case 3:
      statDiffs.push(...getFollowDiff(event as Event<3>, event.prev as Event<3> | undefined));
      break;
    case 6:
      if (firstTaggedId) {
        statDiffs.push(['event_stats', firstTaggedId, 'reposts_count', 1]);
      }
      break;
    case 7:
      if (firstTaggedId) {
        statDiffs.push(['event_stats', firstTaggedId, 'reactions_count', 1]);
      }
  }

  return statDiffs;
}

/** Create an author stats query from the list of diffs. */
function authorStatsQuery(diffs: AuthorStatDiff[]) {
  const values: AuthorStatsRow[] = diffs.map(([_, pubkey, stat, diff]) => {
    const row: AuthorStatsRow = {
      pubkey,
      followers_count: 0,
      following_count: 0,
      notes_count: 0,
    };
    row[stat] = diff;
    return row;
  });

  return db.insertInto('author_stats')
    .values(values)
    .onConflict((oc) =>
      oc
        .column('pubkey')
        .doUpdateSet((eb) => ({
          followers_count: eb('followers_count', '+', eb.ref('excluded.followers_count')),
          following_count: eb('following_count', '+', eb.ref('excluded.following_count')),
          notes_count: eb('notes_count', '+', eb.ref('excluded.notes_count')),
        }))
    );
}

/** Create an event stats query from the list of diffs. */
function eventStatsQuery(diffs: EventStatDiff[]) {
  const values: EventStatsRow[] = diffs.map(([_, event_id, stat, diff]) => {
    const row: EventStatsRow = {
      event_id,
      replies_count: 0,
      reposts_count: 0,
      reactions_count: 0,
    };
    row[stat] = diff;
    return row;
  });

  return db.insertInto('event_stats')
    .values(values)
    .onConflict((oc) =>
      oc
        .column('event_id')
        .doUpdateSet((eb) => ({
          replies_count: eb('replies_count', '+', eb.ref('excluded.replies_count')),
          reposts_count: eb('reposts_count', '+', eb.ref('excluded.reposts_count')),
          reactions_count: eb('reactions_count', '+', eb.ref('excluded.reactions_count')),
        }))
    );
}

/** Set the `prev` value on the event to the last version of the event, if any. */
async function maybeSetPrev<K extends number>(event: Event<K> & { prev?: Event<K> }): Promise<void> {
  if (event.prev?.kind === event.kind) return;

  const [prev] = await eventsDB.getFilters([
    { kinds: [event.kind], authors: [event.pubkey], limit: 1 },
  ]);

  if (prev.created_at < event.created_at) {
    event.prev = prev;
  }
}

/** Set the following count to the total number of unique "p" tags in the follow list. */
function updateFollowingCountQuery({ pubkey, tags }: Event<3>) {
  const following_count = new Set(
    tags
      .filter(([name]) => name === 'p')
      .map(([_, value]) => value),
  ).size;

  return db.insertInto('author_stats')
    .values({
      pubkey,
      following_count,
      followers_count: 0,
      notes_count: 0,
    })
    .onConflict((oc) =>
      oc
        .column('pubkey')
        .doUpdateSet({ following_count })
    );
}

/** Compare the old and new follow events (if any), and return a diff array. */
function getFollowDiff(event: Event<3>, prev?: Event<3>): AuthorStatDiff[] {
  const prevTags = prev?.tags ?? [];

  const prevPubkeys = new Set(
    prevTags
      .filter(([name]) => name === 'p')
      .map(([_, value]) => value),
  );

  const pubkeys = new Set(
    event.tags
      .filter(([name]) => name === 'p')
      .map(([_, value]) => value),
  );

  const added = [...pubkeys].filter((pubkey) => !prevPubkeys.has(pubkey));
  const removed = [...prevPubkeys].filter((pubkey) => !pubkeys.has(pubkey));

  return [
    ...added.map((pubkey): AuthorStatDiff => ['author_stats', pubkey, 'followers_count', 1]),
    ...removed.map((pubkey): AuthorStatDiff => ['author_stats', pubkey, 'followers_count', -1]),
  ];
}

export { updateStats };
