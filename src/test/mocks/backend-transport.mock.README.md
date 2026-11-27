# MockBackendTransport — the WSS seam, scripted

`backend-transport.mock.ts` is the shared scripted-daemon fixture for the
renderer's WSS seam. It is a drop-in replacement for
`$lib/client/live/backend-transport`, exposing the same five runtime functions
plus the `BackendError` class, and driving them from an in-memory registry the
test scripts via `installMockBackend()`.

## The seam

Every migrated `LiveAppClient` domain reaches the daemon through **exactly one**
module — `src/lib/client/live/backend-transport.ts` — via:

| Export                      | Purpose                                                |
| --------------------------- | ------------------------------------------------------ |
| `backendRequest`            | JSON-RPC request over `BACKEND.REQUEST`.               |
| `backendSubscribe`          | `events.subscribe` fast-path over `BACKEND.SUBSCRIBE`. |
| `backendUnsubscribe`        | `events.unsubscribe` fast-path.                        |
| `onBackendNotification`     | Daemon → renderer notifications (§6.3, §6).            |
| `detectLiveStateCapability` | Cached `client.hello` probe for `liveState`.           |

Domain clients, the delta-subscription reconciler, and
`daemon-events-bridge.ts` all compose on top of these. Mocking this one module
gives a coherent scripted daemon to every consumer — no socket, no IPC.

## Boilerplate

`vi.mock()` calls are hoisted **per test file** — a shared helper cannot
`vi.mock` on the consumer's behalf. Consumers place this snippet at the top of
each test file that uses the fixture:

```ts
import { afterEach, beforeEach, vi } from 'vitest';
import {
  installMockBackend,
  resetMockBackend,
  type MockBackendHandle,
} from '../../../test/mocks/backend-transport.mock'; // relative path to fixture

vi.mock('$lib/client/live/backend-transport', async () => {
  const mod = await import('../../../test/mocks/backend-transport.mock');
  return mod.mockBackendTransportModule;
});

let backend: MockBackendHandle;
beforeEach(() => {
  backend = installMockBackend();
});
afterEach(() => {
  resetMockBackend();
});
```

`installMockBackend()` already calls `resetMockBackend()`; the `afterEach` is a
belt-and-braces reset for tests that create sub-handles or rely on other
teardown ordering.

## Scripting API

```ts
backend.onRequest('agent.list', (params) => ({ agents: [] }));
backend.onSubscribe((params) => ({ subscriptionId: 'sub-42' }));
backend.pushEvent({ type: 'agent:idle', data: { agentId: 'a-1' } });
backend.pushSubscriptionPush({
  subscriptionId: 'sub-42',
  kind: 'snapshot',
  seq: 0,
  snapshot: [{ id: 'a-1' }],
});
backend.setLiveStateCapability(true); // drives detectLiveStateCapability()
```

Recorded calls are available via `backend.requests`, `backend.subscribes`, and
`backend.unsubscribes` for assertions.

### Errors (PROTOCOL §9)

Request handlers can `throw` a `BackendError` built with `buildErrorPayload`:

```ts
import { BackendError } from '../../../test/mocks/backend-transport.mock';

backend.onRequest('note.update', () => {
  throw new BackendError(
    backend.builders.buildErrorPayload('CONFLICT', 'expectedVersion mismatch', {
      rpcCode: -32005,
      data: { current: { rev: 3 } },
    }),
  );
});
```

A handler that throws a plain `Error` is wrapped as
`{ code: "MOCK_HANDLER_ERROR", message }`. A method with no registered handler
rejects with `{ code: "MOCK_UNHANDLED_METHOD" }` so tests fail loudly rather
than hang.

## Builders (PROTOCOL-anchored)

`buildEventNotification(type, data, overrides?)` — PROTOCOL §6.3
(`events.event` envelope). Fills `id` / `workspaceId` / `timestamp` / `actor`
with mock defaults; passes `subscriptionId` through when supplied.

`buildSubscriptionPushSnapshot({ subscriptionId, seq?, snapshot })` — PROTOCOL
§6 snapshot frame (seq defaults to 0).

`buildSubscriptionPushDelta({ subscriptionId, seq, delta })` — PROTOCOL §6
delta frame. `delta` = `{ added?, updated?, removedIds? }`.

`buildErrorPayload(code, message, { data?, rpcCode? }?)` — PROTOCOL §9 error
payload matching `BackendErrorPayload` (string `code`, optional numeric
`rpcCode`).

These are the single site the envelope shapes are hard-coded. Live-client and
component tests that hand-roll envelopes migrate to these builders as they are
touched.

## Fakes for a few exports

A test that needs only `backendRequest` (or a few other exports) builds a complete
module with `createBackendTransportFake` from `backend-transport-fake.ts`:

```ts
const backendRequest = vi.hoisted(() => vi.fn());
vi.mock('$lib/client/live/backend-transport', async () =>
  (await import('../../../test/mocks/backend-transport-fake')).createBackendTransportFake({
    backendRequest,
  }),
);
```

Every export you do not pass gets a default, and `readBackendHello` answers from your
`backendRequest('client.hello', {})`. When the transport gains an export, add its
default there; `backend-transport-fake.test.ts` fails until you do.
`intent/no-hand-rolled-backend-transport-mock` rejects new hand-written factories;
files that still have one are baselined under
`eslint-rules/baselines/no-hand-rolled-backend-transport-mock/` and may only shrink.
