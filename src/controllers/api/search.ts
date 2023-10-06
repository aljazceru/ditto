import { AppController } from '@/app.ts';
import * as eventsDB from '@/db/events.ts';
import { type Event, type Filter, nip19, z } from '@/deps.ts';
import * as mixer from '@/mixer.ts';
import { booleanParamSchema } from '@/schema.ts';
import { nostrIdSchema } from '@/schemas/nostr.ts';
import { dedupeEvents, Time } from '@/utils.ts';
import { lookupNip05Cached } from '@/utils/nip05.ts';
import { renderAccount } from '@/views/mastodon/accounts.ts';
import { renderStatus } from '@/views/mastodon/statuses.ts';

/** Matches NIP-05 names with or without an @ in front. */
const ACCT_REGEX = /^@?(?:([\w.+-]+)@)?([\w.-]+)$/;

const searchQuerySchema = z.object({
  q: z.string().transform(decodeURIComponent),
  type: z.enum(['accounts', 'statuses', 'hashtags']).optional(),
  resolve: booleanParamSchema.optional().transform(Boolean),
  following: z.boolean().default(false),
  account_id: nostrIdSchema.optional(),
  limit: z.coerce.number().catch(20).transform((value) => Math.min(Math.max(value, 0), 40)),
});

type SearchQuery = z.infer<typeof searchQuerySchema>;

const searchController: AppController = async (c) => {
  const result = searchQuerySchema.safeParse(c.req.query());

  if (!result.success) {
    return c.json({ error: 'Bad request', schema: result.error }, 422);
  }

  const [event, events] = await Promise.all([
    lookupEvent(result.data),
    searchEvents(result.data),
  ]);

  if (event) {
    events.push(event);
  }

  const results = dedupeEvents(events);

  const [accounts, statuses] = await Promise.all([
    Promise.all(
      results
        .filter((event): event is Event<0> => event.kind === 0)
        .map((event) => renderAccount(event)),
    ),
    Promise.all(
      results
        .filter((event): event is Event<1> => event.kind === 1)
        .map((event) => renderStatus(event, c.get('pubkey'))),
    ),
  ]);

  return c.json({
    accounts: accounts.filter(Boolean),
    statuses: statuses.filter(Boolean),
    hashtags: [],
  });
};

/** Get events for the search params. */
function searchEvents({ q, type, limit, account_id }: SearchQuery): Promise<Event[]> {
  if (type === 'hashtags') return Promise.resolve([]);

  const filter: Filter = {
    kinds: typeToKinds(type),
    search: q,
    limit,
  };

  if (account_id) {
    filter.authors = [account_id];
  }

  return eventsDB.getFilters([filter]);
}

/** Get event kinds to search from `type` query param. */
function typeToKinds(type: SearchQuery['type']): number[] {
  switch (type) {
    case 'accounts':
      return [0];
    case 'statuses':
      return [1];
    default:
      return [0, 1];
  }
}

/** Resolve a searched value into an event, if applicable. */
async function lookupEvent(query: SearchQuery): Promise<Event | undefined> {
  const filters = await getLookupFilters(query);
  const [event] = await mixer.getFilters(filters, { limit: 1, timeout: Time.seconds(1) });
  return event;
}

/** Get filters to lookup the input value. */
async function getLookupFilters({ q, type, resolve }: SearchQuery): Promise<Filter[]> {
  const filters: Filter[] = [];

  const accounts = !type || type === 'accounts';
  const statuses = !type || type === 'statuses';

  if (!resolve || type === 'hashtags') {
    return filters;
  }

  if (new RegExp(`^${nip19.BECH32_REGEX.source}$`).test(q)) {
    try {
      const result = nip19.decode(q);
      switch (result.type) {
        case 'npub':
          if (accounts) filters.push({ kinds: [0], authors: [result.data] });
          break;
        case 'nprofile':
          if (accounts) filters.push({ kinds: [0], authors: [result.data.pubkey] });
          break;
        case 'note':
          if (statuses) filters.push({ kinds: [1], ids: [result.data] });
          break;
        case 'nevent':
          if (statuses) filters.push({ kinds: [1], ids: [result.data.id] });
          break;
      }
    } catch (_e) {
      // do nothing
    }
  } else if (/^[0-9a-f]{64}$/.test(q)) {
    if (accounts) filters.push({ kinds: [0], authors: [q] });
    if (statuses) filters.push({ kinds: [1], ids: [q] });
  } else if (accounts && ACCT_REGEX.test(q)) {
    const pubkey = await lookupNip05Cached(q);
    if (pubkey) {
      filters.push({ kinds: [0], authors: [pubkey] });
    }
  }

  return filters;
}

export { searchController };
