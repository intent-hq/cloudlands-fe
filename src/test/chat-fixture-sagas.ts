import type { DraftsClient } from '$lib/client/app-client';
import type { store } from '$store/renderer/store';
import { fork, join } from 'typed-redux-saga';
import { chatDraftsSaga } from '$store/renderer/slices/chat-drafts/sagas/chat-drafts-saga';
import { questionUiPersistenceSaga } from '$store/renderer/slices/question-ui/sagas/question-ui-persistence-saga';
import { createDraftsFixture } from './fixtures/chat-drafts';

type FixtureStore = Pick<typeof store, 'runSaga'>;
type FixtureDraftsTransport = Pick<DraftsClient, 'get' | 'set' | 'clear'>;

// One running fixture per store. The store's saga manager refuses a second
// `fixtureChatDraftsSaga` with a different function, and the component-test
// bootstrap (playwright/index.ts) already starts one for every mount, so a
// nested start shares the running sagas and only swaps the draft transport.
const running = new WeakMap<FixtureStore, FixtureDraftsTransport[]>();

/**
 * Answer the composer's `drafts.*` requests and persist question UI state, as
 * the app's root sagas do. Without this, a mounted ChatPanel shows the draft
 * loading gate until its 5 s fallback, and removing the gate moves every
 * message row (cloudlands-fe#4160).
 *
 * Component tests get this from the CT bootstrap; hosts need not call it. A
 * nested call while the fixture already runs on `appStore` routes requests to
 * its `transport` until its stop function runs; the outermost call's stops
 * cancel both sagas.
 */
export function startChatFixtureSagas(
  appStore: FixtureStore,
  transport: FixtureDraftsTransport = createDraftsFixture(),
): Array<() => void> {
  const transports = running.get(appStore);
  if (transports) {
    transports.push(transport);
    return [
      () => {
        const index = transports.lastIndexOf(transport);
        if (index >= 0) transports.splice(index, 1);
      },
    ];
  }

  const stack = [transport];
  const current = () => stack[stack.length - 1] ?? transport;
  const delegate: FixtureDraftsTransport = {
    get: (...args) => current().get(...args),
    set: (...args) => current().set(...args),
    clear: (...args) => current().clear(...args),
  };
  running.set(appStore, stack);
  const release = () => {
    if (running.get(appStore) === stack) running.delete(appStore);
  };
  try {
    return [
      release,
      appStore.runSaga(function* fixtureChatDraftsSaga() {
        // Re-registers after a crash restart; `finally` covers a store disposed
        // without its stops, so the next init starts a fresh fixture.
        running.set(appStore, stack);
        try {
          // chatDraftsSaga returns once its watchers fork; join them so
          // `finally` runs only when the saga is cancelled.
          yield* join(yield* fork(chatDraftsSaga, delegate));
        } finally {
          release();
        }
      }),
      appStore.runSaga(questionUiPersistenceSaga),
    ];
  } catch (error) {
    release();
    throw error;
  }
}
