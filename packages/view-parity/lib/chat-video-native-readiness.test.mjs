import assert from 'node:assert/strict';
import { test } from 'node:test';
import { waitForUnplayedNativeVideoControls } from './chat-video-native-readiness.mjs';

// Transport/contract failures only. These doubles are not native-media evidence;
// real animation/readiness is exercised by the maintained browser journeys.
function harness({
  version = {},
  missingPanel = false,
  outcome,
  transportError,
  cleanupError,
} = {}) {
  const calls = [];
  let receipt;
  const session = {
    async send(method, args) {
      calls.push(method);
      if (method === 'Browser.getVersion')
        return {
          product: 'HeadlessChrome/153.0.8010.12',
          revision: '@971a7443b0c9b0a9b2860529b33331b76077ec62',
          ...version,
        };
      if (method === 'DOM.getDocument') return { root: { nodeId: 1 } };
      if (method === 'DOM.querySelector') return { nodeId: 2 };
      if (method === 'DOM.describeNode')
        return {
          node: {
            backendNodeId: 20,
            children: missingPanel
              ? []
              : [
                  {
                    attributes: ['pseudo', '-internal-media-controls-loading-panel'],
                    shadowRoots: [{ backendNodeId: 30 }],
                  },
                ],
          },
        };
      if (method === 'DOM.resolveNode') return { object: { objectId: String(args.backendNodeId) } };
      if (method === 'Runtime.callFunctionOn') {
        if (args.functionDeclaration.includes('this.cancel')) {
          calls.push('cancel');
          if (cleanupError) throw cleanupError;
          return {};
        }
        if (args.awaitPromise) {
          if (transportError) throw transportError;
          return { result: { value: outcome ?? { ok: true, reason: 'already settled' } } };
        }
        return { result: { objectId: 'controller' } };
      }
      return {};
    },
    async detach() {
      calls.push('detach');
    },
  };
  const handle = { evaluate: async () => true, dispose: async () => calls.push('dispose') };
  return {
    calls,
    get receipt() {
      return receipt;
    },
    run: () =>
      waitForUnplayedNativeVideoControls(
        { context: () => ({ newCDPSession: async () => session }) },
        { count: async () => 1, elementHandle: async () => handle },
        {
          attach: async (_name, { body }) => {
            receipt = JSON.parse(body);
          },
        },
        'contract',
      ),
  };
}

for (const version of [{ product: 'HeadlessChrome/154.0.0.0' }, { revision: '@different' }]) {
  test(`rejects unsupported browser identity ${JSON.stringify(version)} before DOM observation`, async () => {
    const h = harness({ version });
    await assert.rejects(h.run(), /Unsupported native-controls browser/);
    assert.ok(!h.calls.includes('DOM.getDocument'));
    assert.deepEqual(h.calls.slice(-3), ['Runtime.releaseObjectGroup', 'detach', 'dispose']);
  });
}

test('missing native panel is a contract failure, never already-settled success', async () => {
  const h = harness({ missingPanel: true });
  await assert.rejects(h.run(), /expected one known loading-panel shadow root/);
  assert.equal(h.receipt.observation, undefined);
  assert.ok(h.calls.includes('detach'));
});

for (const reason of [
  'Native-controls readiness timed out',
  'Target changed, detached, errored, or ceased to be unplayed',
]) {
  test(`propagates ${reason} and cancels/disposes observation`, async () => {
    const h = harness({ outcome: { ok: false, reason, observersCleaned: true } });
    await assert.rejects(h.run(), { message: reason });
    assert.equal(h.receipt.observation.ok, false);
    assert.deepEqual(h.calls.slice(-4), [
      'cancel',
      'Runtime.releaseObjectGroup',
      'detach',
      'dispose',
    ]);
  });
}

test('transport failure preserves its cause even if cancellation fails, and still detaches', async () => {
  const original = new Error('target context destroyed');
  const h = harness({
    transportError: original,
    cleanupError: new Error('controller unavailable'),
  });
  await assert.rejects(h.run(), (error) => error === original);
  assert.match(h.receipt.error, /target context destroyed/);
  assert.deepEqual(h.receipt.cleanupErrors, ['Error: controller unavailable']);
  assert.deepEqual(h.calls.slice(-3), ['Runtime.releaseObjectGroup', 'detach', 'dispose']);
});

test('cleanup failure cannot turn an otherwise settled observation into a pass', async () => {
  const h = harness({ cleanupError: new Error('cancel failed') });
  await assert.rejects(h.run(), /Native-controls cleanup failed/);
  assert.ok(h.calls.includes('detach'));
});
