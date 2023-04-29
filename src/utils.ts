import { Context, getPublicKey, nip19, nip21 } from '@/deps.ts';
import { type Event } from '@/event.ts';

/** Get the current time in Nostr format. */
const nostrNow = () => Math.floor(new Date().getTime() / 1000);

/** Pass to sort() to sort events by date. */
const eventDateComparator = (a: Event, b: Event) => b.created_at - a.created_at;

function getKeys(c: Context) {
  const auth = c.req.headers.get('Authorization') || '';

  if (auth.startsWith('Bearer ')) {
    const privatekey = auth.split('Bearer ')[1];
    const pubkey = getPublicKey(privatekey);

    return {
      privatekey,
      pubkey,
    };
  }
}

/** Return true if the value is a bech32 string, eg for use with NIP-19. */
function isBech32(value: unknown): value is string {
  return typeof value === 'string' && nip21.BECH32_REGEX.test(value);
}

/** Return true if the value is a Nostr pubkey, private key, or event ID. */
function isNostrId(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
}

/** Get pubkey from bech32 string, if applicable. */
function bech32ToPubkey(bech32: string): string | undefined {
  try {
    const decoded = nip19.decode(bech32);

    switch (decoded.type) {
      case 'nprofile':
        return decoded.data.pubkey;
      case 'npub':
        return decoded.data;
    }
  } catch (_) {
    //
  }
}

export { bech32ToPubkey, eventDateComparator, getKeys, isBech32, isNostrId, nostrNow };