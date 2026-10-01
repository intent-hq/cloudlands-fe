/** Selection admission and receipt observation have different lifetimes. */
import { z } from 'zod';
import { repositoryRootKey, type RepositoryRootIdentity } from '$shared/types/repository-context';
import {
  SelectionAttemptSchema,
  SelectionCaptureSchema,
  SelectionCommandSchema,
  SelectionNoticeSchema,
  SelectionQuerySchema,
  type RepositorySelectionSession,
  type SelectionObservation,
  type SelectionCommand,
  type SelectionRetirement,
} from '$shared/types/repository-selection';
import type { JsonRpcClient, RepositoryConnection } from './json-rpc-client';

const PREFIX = 'workspace.repositorySelection.';
const unavailable = () => new Error('REPOSITORY_SELECTION_UNAVAILABLE');
export interface SelectionLifetime extends RepositorySelectionSession {
  readonly stamp: object;
  isLive(): boolean;
  isAdmitted(): boolean;
}

export function createRepositorySelectionFeed(client: JsonRpcClient) {
  type Pending = {
    connection: RepositoryConnection;
    abandoned: boolean;
    ids: Set<string>;
    wake?: () => void;
  };
  type Owned = {
    id: string;
    connection: RepositoryConnection;
    retire(kind: SelectionRetirement): void;
  };
  type Feed = {
    incarnation: object;
    cursor: bigint;
    last: string | null;
    dead: boolean;
    pending: Set<Pending>;
    owned: Set<Owned>;
  };
  let feed: Feed | undefined;
  let disposed = false;
  function close(f: Feed) {
    f.dead = true;
    for (const p of f.pending) {
      p.abandoned = true;
      p.wake?.();
    }
    for (const op of [...f.owned]) op.retire('closed');
  }
  const unsubscribe = client.onRepositoryConnectionEvent((event) => {
    if (event.type === 'opened') {
      if (feed) close(feed);
      feed = {
        incarnation: event.incarnation,
        cursor: 0n,
        last: null,
        dead: false,
        pending: new Set(),
        owned: new Set(),
      };
      return;
    }
    const f = feed;
    if (!f) return;
    if (event.type === 'identity-retired') {
      for (const p of f.pending)
        if (p.connection === event.connection) {
          p.abandoned = true;
          p.wake?.();
        }
      for (const op of [...f.owned]) if (op.connection === event.connection) op.retire('closed');
      return;
    }
    if (event.incarnation !== f.incarnation) return;
    if (event.type === 'closed') {
      close(f);
      return;
    }
    if (event.notification.method !== PREFIX + 'retired' || f.dead) return;
    const parsed = SelectionNoticeSchema.safeParse(event.notification.params);
    if (!parsed.success) {
      close(f);
      return;
    }
    const n = parsed.data;
    if (n.terminal && n.allRetired && n.selectionIds.length === 0) {
      close(f);
      return;
    }
    if (n.terminal || n.allRetired || n.selectionIds.length !== 1) {
      close(f);
      return;
    }
    // The compiled producer emits exactly one ID per normal notice.
    const cursor = BigInt(n.sequence),
      fingerprint = JSON.stringify(n);
    if (cursor === f.cursor && fingerprint === f.last) return;
    if (cursor !== f.cursor + 1n) {
      close(f);
      return;
    }
    f.cursor = cursor;
    f.last = fingerprint;
    for (const p of f.pending) {
      for (const id of n.selectionIds) p.ids.add(id);
      if (p.ids.size > 64) {
        close(f);
        return;
      }
    }
    for (const op of [...f.owned]) if (n.selectionIds.includes(op.id)) op.retire('admission');
    for (const p of f.pending) p.wake?.();
  });
  function requestOriginal(
    connection: object,
    method: string,
    params: unknown,
    options: { timeoutMs: number },
    producer?: object,
  ): Promise<unknown> {
    return producer === undefined
      ? client.requestOnCapturedConnection(connection, method, params, options)
      : client.requestOnCapturedConnection(connection, method, params, options, producer);
  }
  async function releaseWire(
    connection: RepositoryConnection,
    query: object,
    selectionId: string,
    producer?: object,
  ) {
    try {
      const raw = await requestOriginal(
        connection,
        PREFIX + 'release',
        { ...query, selectionId },
        { timeoutMs: 5_000 },
        producer,
      );
      z.object({ released: z.literal(true) })
        .strict()
        .parse(raw);
    } catch {
      /* Only the original connection; server expiry/disconnect remains authoritative. */
    }
  }
  async function capture(
    connection: object,
    root: Readonly<RepositoryRootIdentity>,
  ): Promise<SelectionLifetime> {
    const original = client.getRepositoryConnection(),
      f = feed;
    if (
      disposed ||
      !original ||
      connection !== original ||
      !original.repositorySelection ||
      !f ||
      f.dead ||
      f.incarnation !== original.incarnation ||
      f.pending.size + f.owned.size >= 64
    )
      throw unavailable();
    const query = Object.freeze(
      SelectionQuerySchema.parse({
        workspaceId: root.workspaceId,
        ...(root.kind === 'registered' ? { gitRootId: root.gitRootId } : {}),
      }),
    );
    const started = Date.now();
    const producer = client.beginOriginalProducer?.();
    let acquisitionEnded = false,
      cleanupEnded = false,
      producerEnded = false;
    const finishProducer = () => {
      if (!acquisitionEnded || !cleanupEnded || producerEnded) return;
      producerEnded = true;
      client.finishOriginalProducer?.(producer);
    };
    const cleanupFinished = () => {
      cleanupEnded = true;
      finishProducer();
    };
    const p: Pending = { connection: original, abandoned: false, ids: new Set() };
    f.pending.add(p);
    let knownId: string | undefined,
      adopted = false,
      published = false;
    let deadline: ReturnType<typeof setTimeout> | undefined;
    const originalNow = () =>
      !disposed && !f.dead && !p.abandoned && client.getRepositoryConnection() === original;
    const work = requestOriginal(
      original,
      PREFIX + 'capture',
      query,
      { timeoutMs: 35_000 },
      producer,
    )
      .then(async (raw) => {
        const reference = z
          .object({ selectionId: SelectionCaptureSchema.shape.selectionId })
          .safeParse(raw);
        if (reference.success) knownId = reference.data.selectionId;
        const value = SelectionCaptureSchema.parse(raw);
        if (
          repositoryRootKey(value.root) !== repositoryRootKey(root) ||
          repositoryRootKey(value.snapshot.root) !== repositoryRootKey(root) ||
          value.scope.authorityScopeId !== value.selectionId
        )
          throw unavailable();
        while (originalNow() && f.cursor < BigInt(value.retirementSequence)) {
          await new Promise<void>((resolve) => {
            p.wake = resolve;
          });
          p.wake = undefined;
        }
        if (
          !originalNow() ||
          p.ids.has(value.selectionId) ||
          Date.now() >= started + value.expiresAfterMs
        )
          throw unavailable();
        const { selectionId, retirementSequence: _cursor, ...preview } = value;
        let admitted = true,
          closed = false,
          released = false,
          observations = 0;
        let claim: string | undefined, pending: Promise<SelectionObservation> | undefined;
        let retained: SelectionObservation = {
          current: true,
          attempt: null,
          uncertain: false,
        };
        const listeners = new Set<(kind: SelectionRetirement) => void>();
        let observationTimer: ReturnType<typeof setTimeout> | undefined;
        let actionTimer: ReturnType<typeof setTimeout> | undefined;
        let releaseTask: Promise<void> | undefined;
        const cleanup = () => {
          if (releaseTask) return releaseTask;
          // A release never races another client call on this operation.
          releaseTask = (
            pending
              ? pending.then(
                  () => {},
                  () => {},
                )
              : Promise.resolve()
          )
            .then(() => releaseWire(original, query, selectionId, producer))
            .finally(() => f.owned.delete(op));
          if (producer) void releaseTask.then(cleanupFinished, cleanupFinished);
          return releaseTask;
        };
        const op: Owned = {
          id: selectionId,
          connection: original,
          retire(kind) {
            if (closed || (kind === 'admission' && !admitted)) return;
            admitted = false;
            if (kind === 'closed') {
              closed = true;
              clearTimeout(actionTimer);
              clearTimeout(observationTimer);
              void cleanup();
            }
            for (const listener of [...listeners]) {
              try {
                listener(kind);
              } catch {
                /* Retire all owners. */
              }
            }
            if (closed) listeners.clear();
          },
        };
        const isLive = () => {
          if (!closed && (!originalNow() || released)) op.retire('closed');
          return !closed;
        };
        const current = () => {
          if (Date.now() >= started + value.expiresAfterMs) op.retire('admission');
          return isLive() && admitted;
        };
        const observe = (method: string, extra: object): Promise<SelectionObservation> => {
          if (!isLive() || pending) return Promise.reject(unavailable());
          let finish!: (value: SelectionObservation) => void;
          const task = new Promise<SelectionObservation>((resolve) => {
            finish = resolve;
          });
          pending = task; // Reserve before synchronous socket callbacks can reenter.
          void (async () => {
            try {
              const raw = await requestOriginal(
                original,
                PREFIX + method,
                { ...query, selectionId, ...extra },
                { timeoutMs: 10_000 },
                producer,
              );
              const result = SelectionAttemptSchema.parse(raw);
              if (
                result.selectionId !== selectionId ||
                repositoryRootKey(result.root) !== repositoryRootKey(root)
              )
                throw unavailable();
              if (
                result.attempt.status === 'settled' &&
                'snapshot' in result.attempt.receipt.result &&
                repositoryRootKey(result.attempt.receipt.result.snapshot.root) !==
                  repositoryRootKey(root)
              )
                throw unavailable();
              // Retain original facts before checking current admission/document application.
              if (retained.attempt?.status !== 'settled')
                retained = { current: false, attempt: result.attempt, uncertain: false };
              if (result.attempt.status === 'settled') op.retire('admission');
            } catch {
              retained = {
                ...retained,
                current: false,
                uncertain: retained.attempt?.status !== 'settled',
              };
            }
            return { ...retained, current: current() };
          })().then(finish, () =>
            finish({
              ...retained,
              current: false,
              uncertain: retained.attempt?.status !== 'settled',
            }),
          );
          void task.then(
            () => {
              if (pending === task) pending = undefined;
            },
            () => {
              if (pending === task) pending = undefined;
            },
          );
          return task;
        };
        f.owned.add(op);
        actionTimer = setTimeout(
          () => {
            op.retire('admission');
            if (!claim) op.retire('closed');
          },
          Math.max(0, started + value.expiresAfterMs - Date.now()),
        );
        actionTimer.unref();
        adopted = true;
        return {
          stamp: Object.freeze({}),
          preview,
          isLive,
          isAdmitted: current,
          onRetired(listener: (kind: SelectionRetirement) => void) {
            if (!current()) listener(closed ? 'closed' : 'admission');
            if (!closed) listeners.add(listener);
            return () => {
              listeners.delete(listener);
            };
          },
          confirm(command: SelectionCommand) {
            const selected = SelectionCommandSchema.parse(command),
              key = JSON.stringify(selected);
            if (claim !== undefined) {
              if (claim !== key)
                return Promise.reject(new Error('REPOSITORY_SELECTION_COMMAND_CHANGED'));
              return pending ?? Promise.resolve({ ...retained, current: current() });
            }
            if (!current() || pending) return Promise.reject(unavailable());
            claim = key; // Before any await or queue: only this command can ever be sent.
            observationTimer = setTimeout(() => op.retire('closed'), 300_000);
            observationTimer.unref();
            return observe(
              selected.kind,
              selected.kind === 'save' ? { choice: selected.choice } : {},
            );
          },
          reconcile() {
            if (!isLive() || pending || observations >= 64) return Promise.reject(unavailable());
            observations += 1;
            return observe('reconcile', {});
          },
          release() {
            released = true;
            op.retire('closed');
            return cleanup();
          },
        };
      })
      .finally(() => {
        if (knownId && !adopted)
          void releaseWire(original, query, knownId, producer).finally(() => {
            f.pending.delete(p);
            cleanupFinished();
          });
        else {
          f.pending.delete(p);
          if (!adopted) cleanupFinished();
        }
      });
    if (producer)
      void work.then(
        () => {
          acquisitionEnded = true;
          finishProducer();
        },
        () => {
          acquisitionEnded = true;
          finishProducer();
        },
      );
    void work.then(
      (op) => {
        if (p.abandoned) void op.release();
      },
      () => {},
    );
    try {
      const op = await Promise.race([
        work,
        new Promise<never>((_resolve, reject) => {
          deadline = setTimeout(() => {
            p.abandoned = true;
            p.wake?.();
            reject(unavailable());
          }, 5_000);
          deadline.unref();
        }),
      ]);
      published = true;
      return op;
    } finally {
      clearTimeout(deadline);
      if (!published) {
        p.abandoned = true;
        p.wake?.();
      }
    }
  }
  return {
    capture,
    dispose() {
      if (disposed) return;
      disposed = true;
      if (feed) close(feed);
      unsubscribe();
    },
  };
}
