import { nip19 } from 'nostr-tools';

import { DittoDB } from '@/db/DittoDB.ts';
import { DittoTables } from '@/db/DittoTables.ts';
import { Storages } from '@/storages.ts';

let pubkey: string;
try {
  const result = nip19.decode(Deno.args[0]);
  if (result.type === 'npub') {
    pubkey = result.data;
  } else {
    throw new Error('Invalid npub');
  }
} catch {
  console.error('Invalid npub');
  Deno.exit(1);
}

const store = await Storages.db();
const kysely = await DittoDB.getInstance();

const [followList] = await store.query([{ kinds: [3], authors: [pubkey], limit: 1 }]);

const authorStats: DittoTables['author_stats'] = {
  pubkey,
  followers_count: (await store.count([{ kinds: [3], '#p': [pubkey] }])).count,
  following_count: followList?.tags.filter(([name]) => name === 'p')?.length ?? 0,
  notes_count: (await store.count([{ kinds: [1], authors: [pubkey] }])).count,
};

await kysely.insertInto('author_stats')
  .values(authorStats)
  .onConflict((oc) =>
    oc
      .column('pubkey')
      .doUpdateSet(authorStats)
  )
  .execute();