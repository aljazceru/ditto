import { assertEquals } from '@std/assert';

import { isWorker } from '@/utils/worker.ts';

Deno.test('isWorker from the main thread returns false', () => {
  assertEquals(isWorker(), false);
});

Deno.test('isWorker from a worker thread returns true', async () => {
  const script = `
    import { isWorker } from '@/utils/worker.ts';
    postMessage(isWorker());
    self.close();
  `;

  const worker = new Worker(
    URL.createObjectURL(new Blob([script], { type: 'application/javascript' })),
    { type: 'module' },
  );

  const result = await new Promise<boolean>((resolve) => {
    worker.onmessage = (e) => {
      resolve(e.data);
    };
  });

  worker.terminate();

  assertEquals(result, true);
});
