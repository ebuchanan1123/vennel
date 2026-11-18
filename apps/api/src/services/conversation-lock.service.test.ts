import { describe, expect, it } from 'vitest';

import {
  withConversationLock,
  _getLockChainSizeForTesting,
} from './conversation-lock.service.js';

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

describe('withConversationLock', () => {
  // ── Requirement: same key = sequential ──────────────────────────────────

  it('processes two rapid messages from the same phone in arrival order', async () => {
    const order: number[] = [];

    // Message 1: slow (e.g. OpenAI is taking a while)
    const p1 = withConversationLock('co1:+15551234567', async () => {
      await delay(30);
      order.push(1);
    });

    // Message 2: arrives while message 1 is still processing
    const p2 = withConversationLock('co1:+15551234567', async () => {
      await delay(5);
      order.push(2);
    });

    await Promise.all([p1, p2]);

    // Message 2 must not run before message 1 completes, even though it would
    // finish faster if run concurrently.
    expect(order).toEqual([1, 2]);
  });

  it('second message sees state saved by the first message', async () => {
    let sharedLeadState = { urgency: null as string | null };

    const p1 = withConversationLock('co1:+15559999999', async () => {
      await delay(20);
      // Simulate: first message wrote urgency to DB
      sharedLeadState = { urgency: 'HIGH' };
    });

    const p2 = withConversationLock('co1:+15559999999', async () => {
      // This must run AFTER p1 has committed its write
      return sharedLeadState.urgency;
    });

    const [, resultFromSecond] = await Promise.all([p1, p2]);
    expect(resultFromSecond).toBe('HIGH');
  });

  // ── Requirement: different keys = concurrent ─────────────────────────────

  it('two different phone numbers process independently and concurrently', async () => {
    const order: number[] = [];
    const start = Date.now();

    // Phone A: slow
    const pA = withConversationLock('co1:+15551111111', async () => {
      await delay(40);
      order.push(1);
    });

    // Phone B: fast — should complete before A if truly concurrent
    const pB = withConversationLock('co1:+15552222222', async () => {
      await delay(10);
      order.push(2);
    });

    await Promise.all([pA, pB]);

    // B finished first because different keys run concurrently
    expect(order).toEqual([2, 1]);
    // Total elapsed should be ~40ms (concurrent), not 50ms (sequential)
    expect(Date.now() - start).toBeLessThan(70);
  });

  // ── Requirement: errors do not permanently lock a conversation ───────────

  it('an error in one message does not block the next message', async () => {
    const p1 = withConversationLock('co1:+15553333333', async () => {
      throw new Error('OpenAI timeout');
    });

    // p1 should reject
    await expect(p1).rejects.toThrow('OpenAI timeout');

    // p2 must still be able to run — the lock was released in finally
    const p2 = withConversationLock('co1:+15553333333', async () => 'recovered');
    await expect(p2).resolves.toBe('recovered');
  });

  // ── Requirement: no memory leak ──────────────────────────────────────────

  it('cleans up the lock map entry after all tasks for a key complete', async () => {
    await withConversationLock('co1:+15554444444', async () => {
      await delay(5);
    });

    // After the last task finishes, the entry should be removed
    expect(_getLockChainSizeForTesting()).toBe(0);
  });
});
