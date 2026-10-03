import type {
  NotePagesClient,
  NotePagingCapabilities,
  NotePageRequest,
  NoteReadPage,
  NotePageState,
  NoteSaveOutcome,
  NoteSpliceOperation,
} from '../note-pages';
/** Scripted transport fixture, not a second implementation of daemon paging or writes. */
export class MockNotePagesClient implements NotePagesClient {
  constructor(
    private readonly fixture: {
      capabilities: NotePagingCapabilities | null;
      read: (ws: string, note: string, request: NotePageRequest) => Promise<NoteReadPage>;
      save?: (operation: NoteSpliceOperation) => Promise<NoteSaveOutcome>;
      status?: (operation: NoteSpliceOperation) => Promise<NoteSaveOutcome>;
    },
  ) {}
  private listeners = new Set<{
    ws: string;
    note: string;
    state: (s: NotePageState) => void;
    reset: (e?: string) => void;
  }>();
  capabilities() {
    return Promise.resolve(this.fixture.capabilities);
  }
  read(ws: string, note: string, request: NotePageRequest) {
    return this.fixture.read(ws, note, request);
  }
  applySplices(operation: NoteSpliceOperation) {
    return (
      this.fixture.save?.(operation) ?? Promise.reject(new Error('No mock save receipt configured'))
    );
  }
  operationStatus(operation: NoteSpliceOperation) {
    return (
      this.fixture.status?.(operation) ??
      Promise.reject(new Error('No mock status receipt configured'))
    );
  }
  subscribe(
    ws: string,
    note: string,
    state: (s: NotePageState) => void,
    reset: (e?: string) => void,
  ) {
    const listener = { ws, note, state, reset };
    this.listeners.add(listener);
    reset();
    return () => {
      this.listeners.delete(listener);
    };
  }
  push(state: NotePageState) {
    for (const l of this.listeners)
      if (l.ws === state.scope.workspaceId && l.note === state.scope.noteId) l.state(state);
  }
  reconnect() {
    for (const l of this.listeners) l.reset();
  }
  get subscriptionCount() {
    return this.listeners.size;
  }
}
