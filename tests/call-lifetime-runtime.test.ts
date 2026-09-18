import test from 'node:test';
import assert from 'node:assert/strict';
import { acquireCallStream, createCallLifetime, waitForCurrentCall } from '../src/lib/callLifetime.ts';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

test('ending/restarting a call invalidates every earlier async operation', () => {
  const lifetime = createCallLifetime();
  assert.equal(lifetime.capture()(), false);
  const first = lifetime.begin();
  const upgrade = lifetime.capture();
  assert.equal(first(), true);
  lifetime.end();
  const next = lifetime.begin();
  assert.equal(first(), false);
  assert.equal(upgrade(), false);
  assert.equal(next(), true);
});

test('late microphone and camera permission results release tracks after hangup/unmount', async () => {
  for (const trackCount of [1, 2]) {
    const lifetime = createCallLifetime();
    const isCurrent = lifetime.begin();
    let stopped = 0;
    const stream = { getTracks: () => Array.from({ length: trackCount }, () => ({ stop: () => { stopped++; } })) };
    const media = deferred<typeof stream>();
    const acquire = acquireCallStream(isCurrent, () => media.promise);
    const rejected = assert.rejects(acquire, { name: 'AbortError' });
    lifetime.end();
    lifetime.begin();
    media.resolve(stream);
    await rejected;
    assert.equal(stopped, trackCount);
  }
});

test('current media is preserved and already-cancelled calls never request permission', async () => {
  const lifetime = createCallLifetime();
  const isCurrent = lifetime.begin();
  const stream = { getTracks: () => [{ stop: () => assert.fail('current media stopped') }] };
  assert.equal(await acquireCallStream(isCurrent, async () => stream), stream);
  lifetime.end();
  await assert.rejects(acquireCallStream(isCurrent, async () => assert.fail('cancelled permission request')), /call-cancelled/);
});

test('late TURN and SDP completions cannot continue an ended call or mutate its replacement', async () => {
  for (const stage of ['TURN', 'SDP', 'video-upgrade']) {
    const lifetime = createCallLifetime();
    const isCurrent = lifetime.begin();
    const result = deferred<string>();
    let continued = false;
    const operation = (async () => {
      await waitForCurrentCall(isCurrent, () => result.promise);
      continued = true;
    })();
    const rejected = assert.rejects(operation, /call-cancelled/);
    lifetime.end();
    const replacement = lifetime.begin();
    result.resolve(stage);
    await rejected;
    assert.equal(continued, false);
    assert.equal(replacement(), true);
  }
});

test('active permission and signaling failures retain their original errors', async () => {
  const lifetime = createCallLifetime();
  const current = lifetime.begin();
  const denied = new DOMException('denied', 'NotAllowedError');
  await assert.rejects(acquireCallStream(current, async () => { throw denied; }), (error) => error === denied);
  const failure = new Error('signaling unavailable');
  await assert.rejects(waitForCurrentCall(current, async () => { throw failure; }), (error) => error === failure);
});
