/**
 * Regression test: selectNoteById must react to noteId changes via writable stores.
 *
 * Before the fix, NoteWithComments created the selector with static args at init time:
 *   const currentNote$ = selectNoteById(workspace.id, noteId);
 * If noteId changed (note switch without remount), the selector kept returning the old note.
 *
 * The fix passes writable stores so the selector re-evaluates when noteId changes.
 */
import {
  afterEach,
  describe,
  it,
  expect,
} from "vitest";
import { Store } from "svelte-redux-toolkit/store";
import {
  get,
  readable,
  writable,
  type Readable,
} from "svelte/store";
import { reducers } from "$lib/store/reducer";
import { selectNoteById } from "$lib/store/slices/workspace-notes/workspace-notes-selectors";
import {
  loadWorkspaceNotesSucceeded,
  workspaceNotesReducer,
} from "$lib/store/slices/workspace-notes/workspace-notes-slice";
import type {
  GenericAction,
  ReduxStore,
  StoreState,
} from "$lib/store/types";
import {
  ContentType,
  NoteVisibility,
  type Note,
} from "$shared/types";

const WS_1 = "ws-1";

const createdStores: Store[] = [];

function createTestStore() {
  const store = new Store(reducers);
  let state = {
    workspaceNotes: workspaceNotesReducer(undefined, { type: "@@INIT" }),
  } as StoreState;
  const subscribers = new Set<() => void>();
  const readableState: Readable<StoreState> = readable(state, (set) => {
    const listener = () => set(state);
    subscribers.add(listener);
    set(state);
    return () => subscribers.delete(listener);
  });
  const reduxStore: ReduxStore = {
    dispatch: ((action: GenericAction) => {
      state = {
        ...state,
        workspaceNotes: workspaceNotesReducer(state.workspaceNotes, action),
      } as StoreState;
      subscribers.forEach((listener) => listener());
      return action;
    }) as ReduxStore["dispatch"],
    getState: () => state,
    subscribe: (listener) => {
      subscribers.add(listener);
      return () => subscribers.delete(listener);
    },
    replaceReducer: () => undefined,
  };

  (store as unknown as { storeContext: { store: ReduxStore; storeState: Readable<StoreState> } }).storeContext = {
    store: reduxStore,
    storeState: readableState,
  };
  createdStores.push(store);
  return store;
}

afterEach(() => {
  for (const store of createdStores) {
    store.dispose();
  }
  createdStores.length = 0;
});

function mockNote(id: string, workspaceId = WS_1): Note {
  return {
    id: id as Note["id"],
    workspaceId: workspaceId as Note["workspaceId"],
    title: `Note ${id}`,
    content: `Content for ${id}`,
    contentType: ContentType.Markdown,
    tags: [],
    isPinned: false,
    isArchived: false,
    visibility: NoteVisibility.Private,
    createdAt: "2026-04-14T00:00:00.000Z",
    updatedAt: "2026-04-14T00:00:00.000Z",
  };
}

describe("selectNoteById reactivity with writable store args", () => {
  it("returns the correct note when noteId writable store changes", () => {
    const store = createTestStore();

    // Load two notes into the store
    store.dispatch(
      loadWorkspaceNotesSucceeded([WS_1], {
        [WS_1]: [mockNote("note-a"), mockNote("note-b")],
      }),
    );

    // Create writable stores mirroring the pattern used in NoteWithComments
    const workspaceIdStore = writable(WS_1);
    const noteIdStore = writable("note-a");

    // Create selector at "init time" with writable stores
    const readable$ = selectNoteById.withStore(store)(workspaceIdStore, noteIdStore);

    // Initially should resolve to note-a
    const noteA = get(readable$);
    expect(noteA).toBeDefined();
    expect(noteA!.id).toBe("note-a");
    expect(noteA!.content).toBe("Content for note-a");

    // Switch noteId — simulates navigating to a different note without remounting
    noteIdStore.set("note-b");

    // The readable must now return note-b
    const noteB = get(readable$);
    expect(noteB).toBeDefined();
    expect(noteB!.id).toBe("note-b");
    expect(noteB!.content).toBe("Content for note-b");
  });

  it("returns undefined when noteId writable is set to a non-existent note", () => {
    const store = createTestStore();

    store.dispatch(
      loadWorkspaceNotesSucceeded([WS_1], {
        [WS_1]: [mockNote("note-a")],
      }),
    );

    const workspaceIdStore = writable(WS_1);
    const noteIdStore = writable("note-a");
    const readable$ = selectNoteById.withStore(store)(workspaceIdStore, noteIdStore);

    expect(get(readable$)?.id).toBe("note-a");

    // Switch to a note that doesn't exist
    noteIdStore.set("note-missing");
    expect(get(readable$)).toBeUndefined();
  });

  it("returns undefined when workspaceId writable is cleared", () => {
    const store = createTestStore();

    store.dispatch(
      loadWorkspaceNotesSucceeded([WS_1], {
        [WS_1]: [mockNote("note-a")],
      }),
    );

    const workspaceIdStore = writable<string | null>(WS_1);
    const noteIdStore = writable<string | null>("note-a");
    const readable$ = selectNoteById.withStore(store)(workspaceIdStore, noteIdStore);

    expect(get(readable$)?.id).toBe("note-a");

    // Clear workspace — should return undefined
    workspaceIdStore.set(null);
    expect(get(readable$)).toBeUndefined();
  });
});
