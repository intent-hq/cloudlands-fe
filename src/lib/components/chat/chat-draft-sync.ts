import {
  DRAFT_SYNC_METHOD,
  DRAFT_SYNC_CHANGED,
  DraftSyncResultSchema,
  SharedDraftSchema,
  type DraftSyncRequest,
  type SharedDraft,
  type SharedDraftSnapshot,
} from '$shared/types/chat-draft-sync';
import { backendRequest, onBackendNotification } from '$lib/client/live/backend-transport';
import { isElectronPlatform } from '$lib/utils/platform-capabilities';
import {
  getPrincipalActionContext,
  getPrincipalDraftProvenance,
} from '$store/renderer/slices/principal/principal-context';
import { store } from '$store/renderer/store';

interface DraftSyncTransport {
  request(request: DraftSyncRequest): Promise<unknown>;
  subscribe(listener: (value: unknown) => void): () => void;
}
export interface DraftSyncConnection {
  authority(): string | null;
  read(workspaceId: string, agentId: string): Promise<SharedDraft>;
  edit(
    ownerId: string,
    workspaceId: string,
    agentId: string,
    snapshot: SharedDraftSnapshot,
  ): Promise<SharedDraft>;
  flush(workspaceId: string, agentId: string): Promise<void>;
  clear(workspaceId: string, agentId: string): Promise<void>;
  subscribe(listener: (draft: SharedDraft) => void): () => void;
  dispose(): void;
}
/**
 * The same adapter runs against Electron IPC and the isolated two-renderer fixture.
 * @internal Exposed for the committed shared-draft browser fixture.
 */
export function createDraftSyncConnection(
  transport: DraftSyncTransport,
  provenance: () => string | null,
  context: () => string | null = provenance,
): DraftSyncConnection {
  type Pair = { value?: SharedDraft; tail?: Promise<SharedDraft>; dirty: number };
  const pairs = new Map<string, Pair>();
  const listeners = new Set<(draft: SharedDraft) => void>();
  const origin = crypto.randomUUID();
  let sequence = 0;
  let disposed = false;
  const scope = () => {
    const value = provenance();
    if (disposed || !value) throw new Error('draft-authority-unavailable');
    return value;
  };
  const fence = () => {
    const captured = context();
    if (!captured || disposed) throw new Error('draft-authority-unavailable');
    return () => {
      if (disposed || context() !== captured) throw new Error('draft-authority-changed');
    };
  };
  const pairFor = (authority: string, workspaceId: string, agentId: string) => {
    const key = JSON.stringify([authority, workspaceId, agentId]);
    let pair = pairs.get(key);
    if (!pair) {
      pair = { dirty: 0 };
      pairs.set(key, pair);
    }
    return pair;
  };
  const remember = (draft: SharedDraft, notify: boolean) => {
    if (disposed || draft.provenance !== provenance()) return;
    const pair = pairFor(draft.provenance, draft.workspaceId, draft.agentId);
    if (pair.value?.lifetime === draft.lifetime && pair.value.revision > draft.revision) return;
    pair.value = draft;
    if (notify && pair.dirty === 0) for (const listener of listeners) listener(draft);
  };
  const unsubscribe = transport.subscribe((value) => {
    const parsed = SharedDraftSchema.safeParse(value);
    if (parsed.success) remember(parsed.data, true);
  });
  const invoke = async (request: DraftSyncRequest, current: () => void) => {
    current();
    const result = DraftSyncResultSchema.parse(await transport.request(request));
    current();
    if (request.provenance !== scope() || result.draft.provenance !== request.provenance)
      throw new Error('draft-authority-changed');
    if (!result.accepted) {
      remember(result.draft, false);
      throw new Error('draft-changed-in-another-editor');
    }
    return result.draft;
  };
  const read = async (workspaceId: string, agentId: string) => {
    const authority = scope();
    const current = fence();
    const pair = pairFor(authority, workspaceId, agentId);
    if (pair.tail) await pair.tail;
    const result = await invoke(
      { kind: 'read', provenance: authority, workspaceId, agentId },
      current,
    );
    remember(result, false);
    return result;
  };
  const change = (
    workspaceId: string,
    agentId: string,
    operation: (base: SharedDraft) => DraftSyncRequest,
  ) => {
    const authority = scope();
    const current = fence();
    const pair = pairFor(authority, workspaceId, agentId);
    // Capture the predecessor now. A later peer notification must not become the
    // base for an already queued clear or edit and erase newer peer typing.
    const predecessor =
      pair.tail ??
      (pair.value
        ? Promise.resolve(pair.value)
        : invoke({ kind: 'read', provenance: authority, workspaceId, agentId }, current));
    pair.dirty += 1;
    const work = predecessor.then((base) => invoke(operation(base), current));
    pair.tail = work;
    void work.then(
      (draft) => {
        pair.dirty -= 1;
        if (pair.tail === work) pair.tail = undefined;
        remember(draft, true);
      },
      () => {
        pair.dirty -= 1;
        if (pair.tail === work) pair.tail = undefined;
      },
    );
    return work;
  };
  return {
    authority: () => (disposed ? null : context()),
    read,
    async edit(ownerId, workspaceId, agentId, snapshot) {
      const next = ++sequence;
      return change(workspaceId, agentId, (base) => ({
        kind: 'edit',
        provenance: base.provenance,
        workspaceId,
        agentId,
        lifetime: base.lifetime,
        revision: base.revision,
        origin: ownerId,
        sequence: next,
        snapshot,
      }));
    },
    async flush(workspaceId, agentId) {
      const authority = scope();
      const current = fence();
      const pair = pairFor(authority, workspaceId, agentId);
      const base = await (pair.tail ??
        (pair.value ? Promise.resolve(pair.value) : read(workspaceId, agentId)));
      await invoke(
        {
          kind: 'flush',
          provenance: authority,
          workspaceId,
          agentId,
          lifetime: base.lifetime,
          revision: base.revision,
        },
        current,
      );
    },
    async clear(workspaceId, agentId) {
      await change(workspaceId, agentId, (base) => ({
        kind: 'clear',
        provenance: base.provenance,
        workspaceId,
        agentId,
        lifetime: base.lifetime,
        revision: base.revision,
        origin,
      }));
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    dispose() {
      disposed = true;
      unsubscribe();
      listeners.clear();
      pairs.clear();
    },
  };
}
let liveConnection: DraftSyncConnection | null = null;
export async function persistLiveDraftSnapshot(
  ownerId: string,
  workspaceId: string,
  agentId: string,
  snapshot: SharedDraftSnapshot,
  authority: string,
): Promise<void> {
  const connection = liveConnection;
  if (!connection) throw new Error('draft-shared-transport-unavailable');
  const current = () => {
    if (liveConnection !== connection || connection.authority() !== authority)
      throw new Error('draft-authority-changed');
  };
  current();
  await connection.edit(ownerId, workspaceId, agentId, snapshot);
  current();
  await connection.flush(workspaceId, agentId);
  current();
}
export async function flushDraftBeforeHandoff(workspaceId: string, agentId: string): Promise<void> {
  await Promise.resolve();
  if (liveConnection) await liveConnection.flush(workspaceId, agentId);
}
export function createLiveDraftSyncConnection(): DraftSyncConnection | null {
  if (!isElectronPlatform()) return null;
  const connection = createDraftSyncConnection(
    {
      request: (request) => backendRequest(DRAFT_SYNC_METHOD, request),
      subscribe: (listener) =>
        onBackendNotification((notification) => {
          if (notification.method === DRAFT_SYNC_CHANGED) listener(notification.params);
        }),
    },
    () => getPrincipalDraftProvenance(store.state),
    () => getPrincipalActionContext(store.state),
  );
  liveConnection = connection;
  const dispose = connection.dispose;
  connection.dispose = () => {
    if (liveConnection === connection) liveConnection = null;
    dispose();
  };
  return connection;
}
