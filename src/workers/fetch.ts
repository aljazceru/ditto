import { Comlink } from '@/deps.ts';

import type { FetchWorker } from './fetch.worker.ts';

const _worker = Comlink.wrap<typeof FetchWorker>(
  new Worker(
    new URL('./fetch.worker.ts', import.meta.url),
    { type: 'module' },
  ),
);

const fetchWorker: typeof fetch = async (input) => {
  const url = input instanceof Request ? input.url : input.toString();

  const args = await _worker.fetch(url);
  return new Response(...args);
};

export { fetchWorker };
