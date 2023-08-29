import { type Event } from '@/deps.ts';
import { Subscription } from '@/subscription.ts';

import type { DittoFilter } from '@/filter.ts';
import type { EventData } from '@/types.ts';

/**
 * Manages Ditto event subscriptions.
 * Subscriptions can be added, removed, and matched against events.
 */
class SubscriptionStore {
  #store = new Map<unknown, Map<string, Subscription>>();

  /**
   * Add a subscription to the store, and then iterate over it.
   *
   * ```ts
   * for (const event of Sub.sub(socket, subId, filters)) {
   *   console.log(event);
   * }
   * ```
   */
  sub<K extends number>(socket: unknown, id: string, filters: DittoFilter<K>[]): Subscription<K> {
    let subs = this.#store.get(socket);

    if (!subs) {
      subs = new Map();
      this.#store.set(socket, subs);
    }

    const sub = new Subscription(filters);

    this.unsub(socket, id);
    subs.set(id, sub as unknown as Subscription);

    return sub;
  }

  /** Remove a subscription from the store. */
  unsub(socket: unknown, id: string): void {
    this.#store.get(socket)?.get(id)?.close();
    this.#store.get(socket)?.delete(id);
  }

  /** Remove an entire socket. */
  close(socket: unknown): void {
    const subs = this.#store.get(socket);

    if (subs) {
      for (const sub of subs.values()) {
        sub.close();
      }
    }

    this.#store.delete(socket);
  }

  /**
   * Loop through matching subscriptions to stream out.
   *
   * ```ts
   * for (const sub of Sub.matches(event, data)) {
   *   sub.stream(event);
   * }
   * ```
   */
  *matches(event: Event, data: EventData): Iterable<Subscription> {
    for (const subs of this.#store.values()) {
      for (const sub of subs.values()) {
        if (sub.matches(event, data)) {
          yield sub;
        }
      }
    }
  }
}

const Sub = new SubscriptionStore();

export { Sub };