import { Store } from '@augmentcode/themis/svelte-store';
import { writable } from 'svelte/store';

const initialShell = {
  current: null as string | null,
  panel: null as string | null,
  tabs: ['a', 'b'],
  items: [
    { id: 'a', title: 'Alpha', displayStatus: 'idle' },
    { id: 'b', title: 'Beta', displayStatus: 'idle' },
  ],
  statuses: {},
};

type Action = { type: string; payload?: unknown[] };
const reducers = {
  shell(state = initialShell, action: Action) {
    if (action.type === 'probe/toggle') {
      return { ...state, panel: state.panel === null ? 'all-workspaces' : null };
    }
    if (action.type === 'tabState/openWorkspaceTab') {
      return { ...state, current: String(action.payload?.[0]) };
    }
    if (action.type === 'tabState/closeWorkspaceTab') {
      const id = String(action.payload?.[0]);
      const index = state.tabs.indexOf(id);
      const tabs = state.tabs.filter((tab) => tab !== id);
      const current =
        state.current === id ? (tabs[Math.min(index, tabs.length - 1)] ?? null) : state.current;
      return { ...state, tabs, current };
    }
    return state;
  },
};

class FixtureStore extends Store<{ shell: typeof initialShell }, typeof reducers> {
  protected getExistingStoreContext() {
    // Each test owns a fresh Store, initialized outside a component.
    return undefined;
  }
}

export function createTabLivenessStore() {
  const store = new FixtureStore(reducers);
  const dispose = store.init({ shell: initialShell });
  const route = writable<string | null>(null);
  // Model the configured renderer's synchronous Redux-to-readable bridge while
  // keeping selector subscriptions on the actual Themis implementation.
  const state = writable(store.state);
  return {
    store,
    state,
    route,
    dispose,
    current: store.createSelector((value) => value.shell.current),
    tabs: store.createSelector((value) => value.shell.tabs),
    items: store.createSelector((value) => value.shell.items),
    statuses: store.createSelector((value) => value.shell.statuses),
    panel: store.createSelector((value) => value.shell.panel),
    dispatch(action: Action) {
      store.dispatch(action);
      state.set(store.state);
    },
  };
}
