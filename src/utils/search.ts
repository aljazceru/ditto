import { Kysely, sql } from 'kysely';

import { DittoTables } from '@/db/DittoTables.ts';

/** Get pubkeys whose name and NIP-05 is similar to 'q' */
export async function getPubkeysBySearch(
  kysely: Kysely<DittoTables>,
  opts: { q: string; limit: number; followList: string[] },
) {
  const { q, limit, followList } = opts;

  let query = kysely
    .selectFrom('author_search')
    .select((eb) => [
      'pubkey',
      'search',
      eb.fn('word_similarity', [sql`${q}`, 'search']).as('sml'),
    ])
    .where(() => sql`${q} % search`)
    .orderBy(['sml desc', 'search'])
    .limit(limit);

  const pubkeys = new Set((await query.execute()).map(({ pubkey }) => pubkey));

  if (followList.length > 0) {
    query = query.where('pubkey', 'in', followList);
  }

  const followingPubkeys = new Set((await query.execute()).map(({ pubkey }) => pubkey));

  return Array.from(followingPubkeys.union(pubkeys));
}
