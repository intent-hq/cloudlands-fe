import { afterEach, describe, expect, it } from 'vitest';
import { ReactStore } from '@themislib/themis/react-store';
import { getContext } from 'typed-redux-saga';
import type { StoreDispatch } from '@themislib/themis/types';
import { acquiredTabStateReducer } from './tab-state-acquisition-reducer';
import type { AcquiredTabState } from './tab-state-acquisition-types';
import {
  closeWorkspaceTab,
  loadWorkspaceTabsState,
  openWorkspaceTab,
  reopenLastClosedWorkspaceTab,
  restoreWorkspaceTab,
  serializeWorkspaceTabsState,
  switchToWorkspaceTabByIndex,
  tabStateReducer,
} from './tab-state-slice';
import { workspaceDeleted } from '../workspace-lifecycle/workspace-lifecycle-slice';

type State = { tabState: AcquiredTabState };
type ReduxContext = {
  getState(): State;
  dispatch: StoreDispatch;
  subscribe(callback: () => void): () => void;
};
const disposers: (() => void)[] = [];
afterEach(() => {
  for (const dispose of disposers.splice(0).reverse()) dispose();
});

function fixture() {
  // No product Store, no fixture-populated shared state, no extra saga middleware.
  const realStore = new ReactStore({ tabState: acquiredTabStateReducer });
  disposers.push(realStore.init());
  let redux!: ReduxContext;
  const stop = realStore.runSaga(function* readActualStoreContext() {
    redux = yield* getContext<ReduxContext>('reduxStore');
  });
  disposers.push(stop);
  const serial = (id: string) =>
    redux.getState().tabState.workspaceTabAcquisitions.serialByWorkspaceId[id];
  return { realStore, redux, serial };
}

describe('accepted workspace tab acquisition history', () => {
  it('distinguishes same-ID reopen before a later direct subscriber sees the close', () => {
    const { realStore, redux, serial } = fixture();
    realStore.dispatch(openWorkspaceTab('A'));
    const original = serial('A');
    let closeWasSeenByEarlierSubscriber = false;
    let reenter = true;
    disposers.push(
      redux.subscribe(() => {
        if (reenter && !redux.getState().tabState.openTabs.A) {
          reenter = false;
          closeWasSeenByEarlierSubscriber = true;
          realStore.dispatch(openWorkspaceTab('A'));
        }
      }),
    );
    const later: Array<number | undefined> = [];
    disposers.push(redux.subscribe(() => later.push(serial('A'))));
    realStore.dispatch(closeWorkspaceTab('A', 1));
    expect(closeWasSeenByEarlierSubscriber).toBe(true);
    expect(later.length).toBeGreaterThan(0);
    expect(later).not.toContain(undefined); // Demonstrates why late membership observation fails.
    expect(serial('A')).toBeDefined();
    expect(serial('A')).not.toBe(original); // Independent requirement: retired opening cannot return.
    expect(later.every((value) => value !== original)).toBe(true);
  });

  it('retains acquisition through focus and rejected open/close/index actions', () => {
    const { realStore, serial } = fixture();
    realStore.dispatch(openWorkspaceTab('A'));
    const original = serial('A');
    realStore.dispatch(openWorkspaceTab('B'));
    realStore.dispatch(openWorkspaceTab('A'));
    realStore.dispatch(openWorkspaceTab('A'));
    realStore.dispatch(openWorkspaceTab('new'));
    realStore.dispatch(closeWorkspaceTab('missing', 1));
    realStore.dispatch(switchToWorkspaceTabByIndex(99));
    expect(serial('A')).toBe(original);
    expect(serial('new')).toBeUndefined();
    realStore.dispatch(closeWorkspaceTab('A', 2));
    expect(serial('A')).toBeUndefined();
    realStore.dispatch(reopenLastClosedWorkspaceTab());
    expect(serial('A')).toBeDefined();
    expect(serial('A')).not.toBe(original);
  });

  it('does not treat rejected close of an unreachable restored tab as retirement', () => {
    const { realStore, serial } = fixture();
    realStore.dispatch(
      loadWorkspaceTabsState({
        openTabs: ['A'],
        currentTabId: 'A',
        pinnedTabs: [],
        unsavedTabs: [],
        optimisticTabs: [],
        tabOrder: [],
        workspaceStacks: [],
      }),
    );
    const accepted = serial('A');
    realStore.dispatch(closeWorkspaceTab('A', 3)); // Canonical close rejects IDs absent from stacks.
    expect(serial('A')).toBe(accepted);
    expect(realStore.state.tabState.openTabs.A).toBe(true);
  });

  it('restores background ownership without focus and rotates accepted restore snapshots', () => {
    const { realStore, serial } = fixture();
    realStore.dispatch(openWorkspaceTab('A'));
    realStore.dispatch(restoreWorkspaceTab('B'));
    const beforeA = serial('A');
    const beforeB = serial('B');
    expect(realStore.state.tabState.currentTabId).toBe('A');
    const persisted = serializeWorkspaceTabsState(realStore.state.tabState);
    expect(persisted).not.toHaveProperty('workspaceTabAcquisitions');
    realStore.dispatch(loadWorkspaceTabsState(persisted));
    expect(serial('A')).not.toBe(beforeA);
    expect(serial('B')).not.toBe(beforeB);
    expect(serializeWorkspaceTabsState(realStore.state.tabState)).toEqual(persisted);
  });

  it('retires deletion once and cannot regrant through a rejected same-tab open', () => {
    const { realStore, serial } = fixture();
    realStore.dispatch(openWorkspaceTab('A'));
    realStore.dispatch(workspaceDeleted('A', []));
    expect(serial('A')).toBeUndefined();
    realStore.dispatch(openWorkspaceTab('A'));
    realStore.dispatch(workspaceDeleted('A', []));
    expect(serial('A')).toBeUndefined();
    realStore.dispatch(closeWorkspaceTab('A', 5));
    realStore.dispatch(openWorkspaceTab('A'));
    expect(serial('A')).toBeDefined();
  });

  it('fails closed at integer exhaustion without mutating accepted source fields', () => {
    const accepted = acquiredTabStateReducer(undefined, openWorkspaceTab('A'));
    const exhausted: AcquiredTabState = {
      ...accepted,
      workspaceTabAcquisitions: {
        ...accepted.workspaceTabAcquisitions,
        lastSerial: Number.MAX_SAFE_INTEGER,
      },
    };
    const sourceBefore = serializeWorkspaceTabsState(exhausted);
    expect(() => acquiredTabStateReducer(exhausted, openWorkspaceTab('B'))).toThrow(RangeError);
    expect(serializeWorkspaceTabsState(exhausted)).toEqual(sourceBefore);
    expect(Object.hasOwn(exhausted.openTabs, 'B')).toBe(false);
    // A source no-op neither consumes an ordinal nor throws at the exhausted boundary.
    expect(acquiredTabStateReducer(exhausted, openWorkspaceTab('A'))).toBe(exhausted);
  });

  it('preserves canonical tab outputs and JSON compatibility across real operations', () => {
    const { realStore } = fixture();
    let source = tabStateReducer.initialState;
    const actions = [
      openWorkspaceTab('A'),
      restoreWorkspaceTab('B'),
      openWorkspaceTab('B'),
      closeWorkspaceTab('A', 6),
      reopenLastClosedWorkspaceTab(),
      openWorkspaceTab('new'),
    ];
    for (const action of actions) {
      source = tabStateReducer(source, action);
      realStore.dispatch(action);
      const { workspaceTabAcquisitions, ...sourceFields } = realStore.state.tabState;
      expect(sourceFields).toEqual(source);
      expect(JSON.parse(JSON.stringify(workspaceTabAcquisitions))).toEqual(
        workspaceTabAcquisitions,
      );
      expect(serializeWorkspaceTabsState(realStore.state.tabState)).toEqual(
        serializeWorkspaceTabsState(source),
      );
    }
    const prior = realStore.state.tabState;
    realStore.dispatch(openWorkspaceTab('A'));
    expect(realStore.state.tabState).toBe(prior);
  });
});
