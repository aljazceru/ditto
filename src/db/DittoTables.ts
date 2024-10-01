import { Nullable } from 'kysely';

import { NPostgresSchema } from '@nostrify/db';

export interface DittoTables extends NPostgresSchema {
  nostr_events: NostrEventsRow;
  nip46_tokens: NIP46TokenRow;
  author_stats: AuthorStatsRow;
  event_stats: EventStatsRow;
  pubkey_domains: PubkeyDomainRow;
  event_zaps: EventZapRow;
  push_subscriptions: PushSubscriptionRow;
}

type NostrEventsRow = NPostgresSchema['nostr_events'] & {
  language: Nullable<string>;
};

interface AuthorStatsRow {
  pubkey: string;
  followers_count: number;
  following_count: number;
  notes_count: number;
  search: string;
}

interface EventStatsRow {
  event_id: string;
  replies_count: number;
  reposts_count: number;
  reactions_count: number;
  quotes_count: number;
  reactions: string;
  zaps_amount: number;
}

interface NIP46TokenRow {
  api_token: string;
  user_pubkey: string;
  server_seckey: Uint8Array;
  server_pubkey: string;
  relays: string;
  connected_at: Date;
}

interface PubkeyDomainRow {
  pubkey: string;
  domain: string;
  last_updated_at: number;
}

interface EventZapRow {
  receipt_id: string;
  target_event_id: string;
  sender_pubkey: string;
  amount_millisats: number;
  comment: string;
}

interface PushSubscriptionRow {
  id: bigint;
  pubkey: string;
  endpoint: string;
  key_p256dh: string;
  key_auth: string;
  data: {
    alerts?: {
      mention?: boolean;
      status?: boolean;
      reblog?: boolean;
      follow?: boolean;
      follow_request?: boolean;
      favourite?: boolean;
      poll?: boolean;
      update?: boolean;
      'admin.sign_up'?: boolean;
      'admin.report'?: boolean;
    };
    policy?: 'all' | 'followed' | 'follower' | 'none';
  } | null;
  created_at: Date;
  updated_at: Date;
}
