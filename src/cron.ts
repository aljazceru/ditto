import { Stickynotes } from '@soapbox/stickynotes';

import { Conf } from '@/config.ts';
import { DittoDB } from '@/db/DittoDB.ts';
import { handleEvent } from '@/pipeline.ts';
import { AdminSigner } from '@/signers/AdminSigner.ts';
import { getTrendingTagValues } from '@/trends/trending-tag-values.ts';
import { Time } from '@/utils/time.ts';

const console = new Stickynotes('ditto:trends');

async function updateTrendingTags(tagName: string, kinds: number[], limit: number, extra = '', aliases?: string[]) {
  console.info(`Updating trending #${tagName}...`);
  const kysely = await DittoDB.getInstance();
  const signal = AbortSignal.timeout(1000);

  const yesterday = Math.floor((Date.now() - Time.days(1)) / 1000);
  const now = Math.floor(Date.now() / 1000);

  const tagNames = aliases ? [tagName, ...aliases] : [tagName];

  const trends = await getTrendingTagValues(kysely, tagNames, {
    kinds,
    since: yesterday,
    until: now,
    limit,
  });

  if (!trends.length) {
    return;
  }

  const signer = new AdminSigner();

  const label = await signer.signEvent({
    kind: 1985,
    content: '',
    tags: [
      ['L', 'pub.ditto.trends'],
      ['l', `#${tagName}`, 'pub.ditto.trends'],
      ...trends.map(({ value, authors, uses }) => [tagName, value, extra, authors.toString(), uses.toString()]),
    ],
    created_at: Math.floor(Date.now() / 1000),
  });

  await handleEvent(label, signal);
  console.info(`Trending #${tagName} updated.`);
}

/** Start cron jobs for the application. */
export function cron() {
  Deno.cron('update trending pubkeys', '0 * * * *', () => updateTrendingTags('p', [1, 3], 40, Conf.relay));
  Deno.cron('update trending notes', '15 * * * *', () => updateTrendingTags('e', [1, 6, 7], 40, Conf.relay, ['q']));
  Deno.cron('update trending hashtags', '30 * * * *', () => updateTrendingTags('t', [1], 20));
  Deno.cron('update trending links', '45 * * * *', () => updateTrendingTags('r', [1], 20));
}