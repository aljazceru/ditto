import { Conf } from '@/config.ts';
import { insertUnattachedMedia, UnattachedMedia } from '@/db/unattached-media.ts';
import { configUploader as uploader } from '@/uploaders/config.ts';

interface FileMeta {
  pubkey: string;
  description?: string;
}

/** Upload a file, track it in the database, and return the resulting media object. */
async function uploadFile(file: File, meta: FileMeta, signal?: AbortSignal): Promise<UnattachedMedia> {
  const { type, size } = file;
  const { pubkey, description } = meta;

  if (file.size > Conf.maxUploadSize) {
    throw new Error('File size is too large.');
  }

  const { url, sha256, cid, blurhash } = await uploader.upload(file, { signal });

  const data: string[][] = [
    ['url', url],
    ['m', type],
    ['size', size.toString()],
  ];

  if (sha256) {
    data.push(['x', sha256]);
  }

  if (cid) {
    data.push(['cid', cid]);
  }

  if (blurhash) {
    data.push(['blurhash', blurhash]);
  }

  if (description) {
    data.push(['alt', description]);
  }

  return insertUnattachedMedia({
    id: crypto.randomUUID(),
    pubkey,
    url,
    data,
    uploaded_at: Date.now(),
  });
}

export { uploadFile };
