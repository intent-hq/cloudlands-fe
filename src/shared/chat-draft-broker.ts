import {
  DraftSyncRequestSchema,
  SharedDraftSnapshotSchema,
  type DraftSyncResult,
  type SharedDraft,
  type SharedDraftSnapshot,
} from './types/chat-draft-sync';

export interface SharedDraftPersistence {
  get(
    workspaceId: string,
    agentId: string,
  ): Promise<{ text: string; attachments?: SharedDraftSnapshot['attachments'] } | null>;
  set(
    workspaceId: string,
    agentId: string,
    text: string,
    attachments?: SharedDraftSnapshot['attachments'],
  ): Promise<unknown>;
  clear(workspaceId: string, agentId: string): Promise<unknown>;
}
export interface DraftAdmission {
  /** Main-owned immutable document binding, never a renderer origin string. */
  owner: object;
  current(): boolean;
}
/** One bound connection/principal lifetime. All desktop windows use this same writer. */
export function createChatDraftBroker(
  provenance: string,
  persistence: SharedDraftPersistence,
  changed: (draft: SharedDraft) => void,
  current: () => boolean = () => true,
  failed: (error: unknown) => void = () => {},
) {
  type Entry = {
    draft: SharedDraft;
    owner?: object;
    persisted: number;
    barrier: number;
    writes: Promise<void>;
    timer?: ReturnType<typeof setTimeout>;
  };
  const lifetime = crypto.randomUUID();
  const entries = new Map<string, Promise<Entry>>();
  let disposed = false;
  const live = () => {
    if (disposed || !current()) throw new Error('draft-authority-changed');
  };
  const admit = (admission: DraftAdmission) => {
    live();
    if (!admission.current()) throw new Error('draft-document-retired');
  };
  const persist = (entry: Entry) => {
    if (entry.timer) clearTimeout(entry.timer);
    entry.timer = undefined;
    const draft = entry.draft;
    const write = entry.writes
      .catch(() => {})
      .then(async () => {
        live();
        if (entry.draft.revision !== draft.revision || entry.persisted === draft.revision) return;
        if (!draft.snapshot.text && draft.snapshot.attachments.length === 0)
          await persistence.clear(draft.workspaceId, draft.agentId);
        else
          await persistence.set(
            draft.workspaceId,
            draft.agentId,
            draft.snapshot.text,
            draft.snapshot.attachments.length ? draft.snapshot.attachments : undefined,
          );
        live();
        entry.persisted = draft.revision;
      });
    entry.writes = write;
    return write;
  };
  const entryFor = (workspaceId: string, agentId: string) => {
    const key = JSON.stringify([workspaceId, agentId]);
    let entry = entries.get(key);
    if (!entry) {
      entry = persistence.get(workspaceId, agentId).then((saved): Entry => {
        live();
        return {
          draft: {
            provenance,
            workspaceId,
            agentId,
            lifetime,
            revision: 0,
            origin: '',
            sequence: 0,
            snapshot: SharedDraftSnapshotSchema.parse({
              text: saved?.text ?? '',
              attachments: saved?.attachments ?? [],
            }),
          },
          persisted: 0,
          barrier: 0,
          writes: Promise.resolve(),
        };
      });
      entries.set(key, entry);
      void entry.catch(() => {
        if (entries.get(key) === entry) entries.delete(key);
      });
    }
    return entry;
  };
  return {
    dispose() {
      disposed = true;
      for (const entry of entries.values())
        void entry.then(
          (value) => {
            if (value.timer) clearTimeout(value.timer);
          },
          () => {},
        );
      entries.clear();
    },
    async request(input: unknown, admission: DraftAdmission): Promise<DraftSyncResult> {
      const request = DraftSyncRequestSchema.parse(input);
      admit(admission);
      if (request.provenance !== provenance) throw new Error('draft-authority-changed');
      const entry = await entryFor(request.workspaceId, request.agentId);
      // Awaiting the first durable read cannot grant a retired document a write.
      admit(admission);
      if (request.kind === 'read') return { accepted: true, draft: entry.draft };
      const sameLifetime = request.lifetime === lifetime;
      const latest = sameLifetime && request.revision === entry.draft.revision;
      const continuing =
        request.kind === 'edit' &&
        sameLifetime &&
        request.revision >= entry.barrier &&
        entry.owner === admission.owner &&
        request.origin === entry.draft.origin &&
        request.sequence > entry.draft.sequence;
      if (!latest && !continuing) return { accepted: false, draft: entry.draft };
      if (request.kind === 'edit' || request.kind === 'clear') {
        const snapshot =
          request.kind === 'clear' ? { text: '', attachments: [] } : request.snapshot;
        // Even an already-empty clear retires every older writer, including the same origin.
        if (
          request.kind === 'clear' ||
          JSON.stringify(snapshot) !== JSON.stringify(entry.draft.snapshot)
        ) {
          entry.draft = {
            ...entry.draft,
            snapshot,
            revision: entry.draft.revision + 1,
            origin: request.origin,
            sequence: request.kind === 'edit' ? request.sequence : 0,
          };
          entry.owner = admission.owner;
          if (request.kind === 'clear') entry.barrier = entry.draft.revision;
          changed(entry.draft);
          // Accepted edits belong to the broker, not the originating document's timers.
          if (entry.timer) clearTimeout(entry.timer);
          entry.timer = setTimeout(() => {
            void persist(entry).catch(failed);
          }, 500);
        }
        if (request.kind === 'edit') return { accepted: true, draft: entry.draft };
      }
      await persist(entry);
      live();
      return { accepted: true, draft: entry.draft };
    },
  };
}
