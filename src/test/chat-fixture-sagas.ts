import type { DraftSyncConnection } from '$lib/components/chat/chat-draft-sync';
import type { DraftsClient } from '$lib/client/app-client';
import type { store } from '$store/renderer/store';
import { cancelled, fork, join } from 'typed-redux-saga';
import { chatDraftsSaga } from '$store/renderer/slices/chat-drafts/sagas/chat-drafts-saga';
import { questionUiPersistenceSaga } from '$store/renderer/slices/question-ui/sagas/question-ui-persistence-saga';
import { createDraftsFixture } from './fixtures/chat-drafts';

type FixtureStore = Pick<typeof store, 'runSaga'>;
type FixtureDraftsTransport = Pick<DraftsClient, 'get' | 'set' | 'clear'> & {
  sync?: DraftSyncConnection;
};

interface FixtureState {
  /** Transports by start order; the innermost (last) one serves drafts. */
  transports: FixtureDraftsTransport[];
  /** Stops the draft saga serving the innermost transport. */
  stopDrafts: () => void;
  /** The draft saga run currently serving; cleared before this module stops it. */
  serving: object | null;
}

// One draft fixture per store. The store's saga manager refuses a second
// `fixtureChatDraftsSaga` with a different function, and the component-test
// bootstrap (playwright/index.ts) already starts one for every mount, so a
// nested start replaces the running draft saga instead of adding one.
const running = new WeakMap<FixtureStore, FixtureState>();

function runDrafts(appStore: FixtureStore, state: FixtureState) {
  const transport = state.transports[state.transports.length - 1];
  const run = {};
  state.serving = run;
  const stop = appStore.runSaga(function* fixtureChatDraftsSaga() {
    try {
      // chatDraftsSaga returns once its watchers fork; join them so the
      // cleanup below sees the saga's cancellation.
      yield* join(yield* fork(chatDraftsSaga, transport, transport.sync ?? null));
    } finally {
      // A store disposed without its stops cancels the serving run from
      // outside; forget it so the next init starts a fresh fixture. This
      // module clears `serving` before its own stops, and a crash restarts
      // the same function, so both keep the registration.
      if ((yield* cancelled()) && state.serving === run && running.get(appStore) === state) {
        running.delete(appStore);
      }
    }
  });
  state.stopDrafts = () => {
    if (state.serving === run) state.serving = null;
    stop();
  };
}

/**
 * Answer the composer's `drafts.*` requests and persist question UI state, as
 * the app's root sagas do. Without this, a mounted ChatPanel shows the draft
 * loading gate until its 5 s fallback, and removing the gate moves every
 * message row (cloudlands-fe#4160).
 *
 * Component tests get this from the CT bootstrap; hosts need not call it. A
 * call while the fixture already runs on `appStore` serves drafts from its
 * `transport` until its stop runs: the stop cancels that draft saga, dropping
 * its pending restores and writes as a host-owned saga always did, and starts
 * a fresh one for the transport underneath. Only the innermost transport
 * serves, so two nested hosts mounted together share the later one, and each
 * switch also drops the replaced saga's in-flight work: a composer still
 * mounted from before the switch waits for its restore fallback.
 */
export function startChatFixtureSagas(
  appStore: FixtureStore,
  transport: FixtureDraftsTransport = createDraftsFixture(),
): Array<() => void> {
  const active = running.get(appStore);
  if (active) {
    active.stopDrafts();
    active.transports.push(transport);
    runDrafts(appStore, active);
    let stopped = false;
    return [
      () => {
        if (stopped) return;
        stopped = true;
        const index = active.transports.lastIndexOf(transport);
        if (index < 0 || running.get(appStore) !== active) return;
        const serving = index === active.transports.length - 1;
        if (serving) active.stopDrafts();
        active.transports.splice(index, 1);
        if (serving) runDrafts(appStore, active);
      },
    ];
  }

  const state: FixtureState = { transports: [transport], stopDrafts: () => {}, serving: null };
  running.set(appStore, state);
  try {
    runDrafts(appStore, state);
    const stopQuestions = appStore.runSaga(questionUiPersistenceSaga);
    return [
      () => {
        if (running.get(appStore) === state) running.delete(appStore);
        state.stopDrafts();
      },
      stopQuestions,
    ];
  } catch (error) {
    running.delete(appStore);
    throw error;
  }
}
