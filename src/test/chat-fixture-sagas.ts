import type { DraftsClient } from '$lib/client/app-client';
import type { store } from '$store/renderer/store';
import { cancelled, fork, join } from 'typed-redux-saga';
import { chatDraftsSaga } from '$store/renderer/slices/chat-drafts/sagas/chat-drafts-saga';
import { questionUiPersistenceSaga } from '$store/renderer/slices/question-ui/sagas/question-ui-persistence-saga';
import { createDraftsFixture } from './fixtures/chat-drafts';

type FixtureStore = Pick<typeof store, 'runSaga'>;
type FixtureDraftsTransport = Pick<DraftsClient, 'get' | 'set' | 'clear'>;

interface FixtureState {
  /** Transports by start order; the innermost (last) one serves drafts. */
  transports: FixtureDraftsTransport[];
  /** Stops the draft saga serving the innermost transport. */
  stopDrafts: () => void;
  /** Set while this module itself stops the draft saga. */
  switching: boolean;
}

// One draft fixture per store. The store's saga manager refuses a second
// `fixtureChatDraftsSaga` with a different function, and the component-test
// bootstrap (playwright/index.ts) already starts one for every mount, so a
// nested start replaces the running draft saga instead of adding one.
const running = new WeakMap<FixtureStore, FixtureState>();

function runDrafts(appStore: FixtureStore, state: FixtureState) {
  const transport = state.transports[state.transports.length - 1];
  const stop = appStore.runSaga(function* fixtureChatDraftsSaga() {
    try {
      // chatDraftsSaga returns once its watchers fork; join them so the
      // cleanup below sees the saga's cancellation.
      yield* join(yield* fork(chatDraftsSaga, transport));
    } finally {
      // A store disposed without its stops cancels the saga from outside;
      // forget it so the next init starts a fresh fixture. A crash restarts
      // the same function, so it keeps the registration.
      if ((yield* cancelled()) && !state.switching && running.get(appStore) === state) {
        running.delete(appStore);
      }
    }
  });
  state.stopDrafts = () => {
    state.switching = true;
    try {
      stop();
    } finally {
      state.switching = false;
    }
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
 * serves, so two nested hosts mounted together share the later one.
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

  const state: FixtureState = { transports: [transport], stopDrafts: () => {}, switching: false };
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
