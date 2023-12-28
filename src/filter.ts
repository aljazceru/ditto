import { Conf } from '@/config.ts';
import { type Event, type Filter, matchFilters, stringifyStable } from '@/deps.ts';

import type { EventData } from '@/types.ts';

/** Additional properties that may be added by Ditto to events. */
type Relation = 'author' | 'author_stats' | 'event_stats';

/** Custom filter interface that extends Nostr filters with extra options for Ditto. */
interface DittoFilter<K extends number = number> extends Filter<K> {
  /** Whether the event was authored by a local user. */
  local?: boolean;
  /** Additional fields to add to the returned event. */
  relations?: Relation[];
}

/** Filter to get one specific event. */
type MicroFilter = { ids: [Event['id']] } | { kinds: [0]; authors: [Event['pubkey']] };

/** Additional options to apply to the whole subscription. */
interface GetFiltersOpts {
  /** Signal to abort the request. */
  signal?: AbortSignal;
  /** Event limit for the whole subscription. */
  limit?: number;
  /** Relays to use, if applicable. */
  relays?: WebSocket['url'][];
}

function matchDittoFilter(filter: DittoFilter, event: Event, data: EventData): boolean {
  if (filter.local && !(data.user || event.pubkey === Conf.pubkey)) {
    return false;
  }

  return matchFilters([filter], event);
}

/**
 * Similar to nostr-tools `matchFilters`, but supports Ditto's custom keys.
 * Database calls are needed to look up the extra data, so it's passed in as an argument.
 */
function matchDittoFilters(filters: DittoFilter[], event: Event, data: EventData): boolean {
  for (const filter of filters) {
    if (matchDittoFilter(filter, event, data)) {
      return true;
    }
  }

  return false;
}

/** Get deterministic ID for a microfilter. */
function getFilterId(filter: MicroFilter): string {
  if ('ids' in filter) {
    return stringifyStable({ ids: [filter.ids[0]] });
  } else {
    return stringifyStable({
      kinds: [filter.kinds[0]],
      authors: [filter.authors[0]],
    });
  }
}

/** Get a microfilter from a Nostr event. */
function eventToMicroFilter(event: Event): MicroFilter {
  if (event.kind === 0) {
    return { kinds: [0], authors: [event.pubkey] };
  } else {
    return { ids: [event.id] };
  }
}

export {
  type DittoFilter,
  eventToMicroFilter,
  getFilterId,
  type GetFiltersOpts,
  matchDittoFilters,
  type MicroFilter,
  type Relation,
};
