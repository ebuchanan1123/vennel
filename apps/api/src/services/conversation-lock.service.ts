/**
 * Lightweight in-process per-conversation sequential queue.
 *
 * Problem: Twilio may deliver multiple SMS messages for the same customer
 * nearly simultaneously. Without serialisation, two handlers could both
 * read the same stale lead state from the DB, run OpenAI in parallel, and
 * then both write back — causing qualification fields from the first message
 * to be lost or the second message to ask questions already answered.
 *
 * Solution: A promise-chain mutex keyed by conversation ID
 * (companyId + normalised phone).
 *
 *   Message A arrives → acquire lock → read DB → run AI → write DB → release
 *   Message B arrives → waits for A → reads UPDATED DB → run AI → write DB → release
 *
 * Properties:
 *  - Same key = sequential processing in arrival order.
 *  - Different keys = fully concurrent (no cross-conversation blocking).
 *  - Lock is always released in `finally`, so errors never permanently block.
 *  - Map entries are deleted when no further tasks are waiting (no memory leak).
 */

/** Maps conversation key → the tail of the pending promise chain for that key. */
const chains = new Map<string, Promise<void>>();

/**
 * Run `fn` exclusively for `key`.
 * Concurrent callers with the same key are queued and run one at a time.
 * Concurrent callers with different keys run in parallel.
 */
export async function withConversationLock<T>(
  key: string,
  fn: () => Promise<T>,
): Promise<T> {
  // What was the last pending operation for this conversation?
  const tail = chains.get(key) ?? Promise.resolve();

  // Allocate a new completion signal so the next caller can chain off us.
  let releaseTail!: () => void;
  const newTail = new Promise<void>((resolve) => {
    releaseTail = resolve;
  });
  chains.set(key, newTail);

  // Wait for the previous tail to settle, then run our work.
  return tail.then(async () => {
    try {
      return await fn();
    } finally {
      releaseTail(); // unblock any waiter that arrived after us
      // If nobody else appended while we were running, clean up.
      if (chains.get(key) === newTail) {
        chains.delete(key);
      }
    }
  });
}

/** Exposed only for tests — lets suites inspect internal state. */
export function _getLockChainSizeForTesting(): number {
  return chains.size;
}
