import {describe, expect, it} from 'vitest';
import {
  trackPendingAudioAdjustment,
  waitForPendingAudioAdjustments,
} from './pendingAudioAdjustments';

function deferred(): {promise: Promise<void>; resolve: () => void} {
  let resolve!: () => void;
  const promise = new Promise<void>(r => {
    resolve = r;
  });
  return {promise, resolve};
}

describe('waitForPendingAudioAdjustments', () => {
  it('resolves immediately when nothing is pending', async () => {
    let settled = false;
    await waitForPendingAudioAdjustments().then(() => {
      settled = true;
    });
    expect(settled).toBe(true);
  });

  it('waits for an in-flight adjustment to settle', async () => {
    const a = deferred();
    trackPendingAudioAdjustment(a.promise);

    let settled = false;
    const wait = waitForPendingAudioAdjustments().then(() => {
      settled = true;
    });

    await Promise.resolve();
    expect(settled).toBe(false);

    a.resolve();
    await wait;
    expect(settled).toBe(true);
  });

  it('also covers adjustments queued while waiting', async () => {
    const first = deferred();
    trackPendingAudioAdjustment(first.promise);

    const second = deferred();
    let settled = false;
    const wait = waitForPendingAudioAdjustments().then(() => {
      settled = true;
    });

    // A new adjustment appears before the first settles (mirrors a
    // recalculation re-registering a clip while its measurement is in flight).
    trackPendingAudioAdjustment(second.promise);
    first.resolve();
    await Promise.resolve();
    expect(settled).toBe(false);

    second.resolve();
    await wait;
    expect(settled).toBe(true);
  });
});
