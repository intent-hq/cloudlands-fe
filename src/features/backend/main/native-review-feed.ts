/** Native review admission and receipt observation have different lifetimes. */
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { repositoryRootKey } from '$shared/types/repository-context';
import {
  NativeReviewCaptureSchema,
  NativeReviewInputSchema,
  NativeReviewTextCommandSchema,
  NativeReviewNoticeSchema,
  NativeReviewExecuteResultSchema,
  NativeReviewReconcileResultSchema,
  type NativeReviewSession,
  type NativeReviewExecuteResult,
  type NativeReviewReconcileResult,
  type NativeReviewObservation,
  type NativeReviewInput,
  type NativeReviewTextCommand,
  type NativeReviewRetirement,
} from '$shared/types/native-review-operation';
import type { JsonRpcClient, RepositoryConnection } from './json-rpc-client';

const PREFIX = 'accept-changes.';
const unavailable = () => new Error('NATIVE_REVIEW_UNAVAILABLE');
type CompanionInput = {
  workspaceId: string;
  action: 'create-pr';
  review: {
    root: NativeReviewInput['review']['root'];
    choice: { kind: 'afterCommit'; operationId: string; captureId: string };
  };
};
export interface NativeReviewLifetime extends NativeReviewSession {
  readonly stamp: object;
  isLive(): boolean;
  isAdmitted(): boolean;
  prepareCompanion?(): Promise<NativeReviewLifetime>;
}

export function createNativeReviewFeed(client: JsonRpcClient) {
  type Pending = {
    connection: RepositoryConnection;
    abandoned: boolean;
    ids: Set<string>;
    wake?: () => void;
  };
  type Owned = {
    id: string;
    connection: RepositoryConnection;
    retire(kind: NativeReviewRetirement): void;
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
    const parsed = NativeReviewNoticeSchema.safeParse(event.notification.params);
    if (!parsed.success) {
      close(f);
      return;
    }
    const n = parsed.data;
    if (n.terminal && n.allRetired && n.operationIds.length === 0) {
      close(f);
      return;
    }
    if (n.terminal || n.allRetired || n.operationIds.length !== 1) {
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
      for (const id of n.operationIds) p.ids.add(id);
      if (p.ids.size > 64) {
        close(f);
        return;
      }
    }
    for (const op of [...f.owned]) if (n.operationIds.includes(op.id)) op.retire('admission');
    for (const p of f.pending) p.wake?.();
  });
  async function releaseWire(connection: RepositoryConnection, query: object) {
    try {
      const raw = await client.requestOnCapturedConnection(connection, PREFIX + 'release', query, {
        timeoutMs: 5_000,
      });
      z.object({ released: z.literal(true) })
        .strict()
        .parse(raw);
    } catch {
      // Never reconnect to dispose. Server expiry/disconnection is the remaining fallback.
    }
  }
  async function prepare(
    connection: object,
    input: NativeReviewInput,
  ): Promise<NativeReviewLifetime> {
    return acquire(connection, NativeReviewInputSchema.parse(input));
  }
  async function acquire(
    connection: object,
    query: NativeReviewInput | CompanionInput,
    parentDeadline?: number,
  ): Promise<NativeReviewLifetime> {
    const original = client.getRepositoryConnection(),
      f = feed;
    const marked = 'companion' in query.review && query.review.companion !== undefined;
    if (
      disposed ||
      !original ||
      connection !== original ||
      !original.nativeReview ||
      ((marked || parentDeadline !== undefined) && !original.nativeReviewCompanion) ||
      !f ||
      f.dead ||
      f.incarnation !== original.incarnation ||
      f.pending.size + f.owned.size >= 32
    )
      throw unavailable();
    const root = query.review.root;
    if (Buffer.byteLength(JSON.stringify(query)) > 65_536) throw unavailable();
    const started = Date.now();
    const acquireDeadline = Math.min(started + 5_000, parentDeadline ?? Infinity);
    if (started >= acquireDeadline) throw unavailable();
    const p: Pending = { connection: original, abandoned: false, ids: new Set() };
    f.pending.add(p);
    let knownId: string | undefined,
      adopted = false,
      published = false;
    let deadline: ReturnType<typeof setTimeout> | undefined;
    const originalNow = () =>
      !disposed && !f.dead && !p.abandoned && client.getRepositoryConnection() === original;
    const work = client
      .requestOnCapturedConnection(original, PREFIX + 'prepare', query, { timeoutMs: 35_000 })
      .then(async (raw) => {
        const reference = z
          .object({ reviewOperation: z.object({ operationId: z.string().min(1).max(4096) }) })
          .safeParse(raw);
        if (reference.success) knownId = reference.data.reviewOperation.operationId;
        const value = NativeReviewCaptureSchema.parse(raw);
        const { reviewOperation, ...display } = value;
        const operationId = reviewOperation.operationId,
          preparation = display.reviewPreparation;
        if (
          repositoryRootKey(reviewOperation.root) !== repositoryRootKey(root) ||
          repositoryRootKey(preparation.root) !== repositoryRootKey(root) ||
          preparation.operationId !== operationId ||
          preparation.scope.authorityScopeId !== operationId ||
          preparation.contextRevision.epoch !== operationId ||
          preparation.contextRevision.sequence !== '1'
        )
          throw unavailable();
        while (originalNow() && f.cursor < BigInt(reviewOperation.retirementSequence)) {
          await new Promise<void>((resolve) => {
            p.wake = resolve;
          });
          p.wake = undefined;
        }
        if (
          !originalNow() ||
          p.ids.has(operationId) ||
          Date.now() >=
            Math.min(started + reviewOperation.expiresAfterMs, parentDeadline ?? Infinity)
        )
          throw unavailable();
        const bound = { workspaceId: root.workspaceId, operationId, root };
        let admitted = true,
          closed = false,
          released = false,
          observations = 0;
        let claim: string | undefined, pending: Promise<NativeReviewObservation> | undefined;
        let retained: NativeReviewObservation = {
          current: true,
          uncertain: false,
          execute: null,
          reconciliation: null,
        };
        const listeners = new Set<(kind: NativeReviewRetirement) => void>();
        let retentionTimer: ReturnType<typeof setTimeout> | undefined;
        let releaseTask: Promise<void> | undefined;
        let settledAt: number | undefined;
        let companionTask: Promise<NativeReviewLifetime> | undefined;
        const cleanup = () => {
          if (releaseTask) return releaseTask;
          // Release immediately to stop future stages. The outstanding original completion
          // remains privately owned; a release reply does not assert that it stopped.
          releaseTask = releaseWire(original, bound);
          const childCleanup = companionTask?.then(
            (captured) => captured.release(),
            () => {},
          );
          void Promise.allSettled([
            releaseTask,
            ...(pending ? [pending] : []),
            ...(childCleanup ? [childCleanup] : []),
          ]).then(() => f.owned.delete(op));
          return releaseTask;
        };
        const op: Owned = {
          id: operationId,
          connection: original,
          retire(kind) {
            if (closed || (kind === 'admission' && !admitted)) return;
            admitted = false;
            if (kind === 'closed') {
              closed = true;
              clearTimeout(actionTimer);
              clearTimeout(retentionTimer);
              void cleanup();
            }
            for (const listener of [...listeners]) {
              try {
                listener(kind);
              } catch {
                /* Retire every owner. */
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
          if (Date.now() >= started + reviewOperation.expiresAfterMs) op.retire('admission');
          return isLive() && admitted;
        };
        const known = () =>
          retained.execute?.state === 'settled' || retained.reconciliation?.state === 'settled';
        const observe = (
          method: 'execute' | 'reconcile',
          extra: object,
        ): Promise<NativeReviewObservation> => {
          if (!isLive() || pending) return Promise.reject(unavailable());
          let finish!: (value: NativeReviewObservation) => void;
          const task = new Promise<NativeReviewObservation>((resolve) => {
            finish = resolve;
          });
          pending = task;
          void (async () => {
            try {
              const raw = await client.requestOnCapturedConnection(
                original,
                PREFIX + method,
                method === 'execute'
                  ? {
                      workspaceId: query.workspaceId,
                      action: query.action,
                      review: { operationId, root },
                      ...extra,
                    }
                  : bound,
                { timeoutMs: method === 'execute' ? 375_000 : 10_000 },
              );
              const result: NativeReviewExecuteResult | NativeReviewReconcileResult =
                method === 'execute'
                  ? NativeReviewExecuteResultSchema.parse(raw)
                  : NativeReviewReconcileResultSchema.parse(raw);
              if (
                result.operationId !== operationId ||
                repositoryRootKey(result.root) !== repositoryRootKey(root)
              )
                throw unavailable();
              const execution = result.reviewExecution;
              if (
                execution &&
                (execution.requestId !== operationId ||
                  execution.preparation.operationId !== operationId ||
                  repositoryRootKey(execution.preparation.root) !== repositoryRootKey(root) ||
                  JSON.stringify(execution.preparation.scope) !==
                    JSON.stringify(preparation.scope) ||
                  JSON.stringify(execution.preparation.contextRevision) !==
                    JSON.stringify(preparation.contextRevision))
              )
                throw unavailable();
              // Preserve the original wire envelope before checking presentation lifetime.
              if (method === 'execute')
                retained = { ...retained, execute: NativeReviewExecuteResultSchema.parse(raw) };
              else if (retained.reconciliation?.state !== 'settled')
                retained = {
                  ...retained,
                  reconciliation: NativeReviewReconcileResultSchema.parse(raw),
                };
              retained.uncertain =
                result.reviewExecution?.outcome.status === 'uncertain' ||
                (!known() && result.state === 'pending');
              if (result.state === 'settled') {
                if (settledAt === undefined) {
                  settledAt = Date.now();
                  clearTimeout(retentionTimer);
                  if (!closed) {
                    retentionTimer = setTimeout(() => op.retire('closed'), 600_000);
                    retentionTimer.unref();
                  }
                }
                op.retire('admission');
              }
            } catch {
              retained = { ...retained, current: false, uncertain: retained.uncertain || !known() };
            }
            return { ...retained, current: current() };
          })().then(finish, () =>
            finish({ ...retained, current: false, uncertain: retained.uncertain || !known() }),
          );
          void task.then(() => {
            if (pending === task) pending = undefined;
          });
          return task;
        };
        f.owned.add(op);
        const actionTimer = setTimeout(
          () => {
            op.retire('admission');
            if (!claim) op.retire('closed');
          },
          Math.max(0, started + reviewOperation.expiresAfterMs - Date.now()),
        );
        actionTimer.unref();
        adopted = true;
        return {
          ...(marked
            ? {
                prepareCompanion() {
                  if (companionTask) return companionTask;
                  // Reserve even a refusal before an await; no second wire capture can repair it.
                  companionTask = Promise.resolve().then(async () => {
                    const executed = retained.execute;
                    if (
                      !isLive() ||
                      pending ||
                      Date.now() >= started + reviewOperation.expiresAfterMs ||
                      !executed?.success ||
                      executed.state !== 'settled' ||
                      retained.uncertain ||
                      executed.reviewExecution?.outcome.status !== 'not-attempted' ||
                      executed.reviewExecution.gitReceipts.length !== 1 ||
                      executed.reviewExecution.gitReceipts[0].stage !== 'commit' ||
                      !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(operationId)
                    )
                      throw unavailable();
                    const captured = await acquire(
                      original,
                      {
                        workspaceId: root.workspaceId,
                        action: 'create-pr',
                        review: {
                          root,
                          choice: { kind: 'afterCommit', operationId, captureId: randomUUID() },
                        },
                      },
                      started + reviewOperation.expiresAfterMs,
                    );
                    if (!isLive() || Date.now() >= started + reviewOperation.expiresAfterMs) {
                      await captured.release();
                      throw unavailable();
                    }
                    return captured;
                  });
                  return companionTask;
                },
              }
            : {}),
          stamp: Object.freeze({}),
          preview: { ...display, root, expiresAfterMs: reviewOperation.expiresAfterMs },
          isLive,
          isAdmitted: current,
          onRetired(listener: (kind: NativeReviewRetirement) => void) {
            if (!current()) listener(closed ? 'closed' : 'admission');
            if (!closed) listeners.add(listener);
            return () => {
              listeners.delete(listener);
            };
          },
          confirm(command: NativeReviewTextCommand) {
            const selected = NativeReviewTextCommandSchema.parse(command),
              key = JSON.stringify(selected);
            if (claim !== undefined) {
              if (claim !== key) return Promise.reject(new Error('NATIVE_REVIEW_COMMAND_CHANGED'));
              return pending ?? Promise.resolve({ ...retained, current: current() });
            }
            if (
              !current() ||
              pending ||
              !display.valid ||
              Buffer.byteLength(
                JSON.stringify({
                  workspaceId: query.workspaceId,
                  action: query.action,
                  review: { operationId, root },
                  ...selected,
                }),
              ) > 65_536
            )
              return Promise.reject(unavailable());
            claim = key;
            // Local resource bound for an unobserved outcome, not proof of server completion.
            retentionTimer = setTimeout(() => op.retire('closed'), 375_000 + 600_000);
            retentionTimer.unref();
            return observe('execute', selected);
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
          void releaseWire(original, {
            workspaceId: root.workspaceId,
            operationId: knownId,
            root,
          }).finally(() => f.pending.delete(p));
        else f.pending.delete(p);
      });
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
          deadline = setTimeout(
            () => {
              p.abandoned = true;
              p.wake?.();
              reject(unavailable());
            },
            Math.max(0, acquireDeadline - Date.now()),
          );
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
    prepare,
    dispose() {
      if (disposed) return;
      disposed = true;
      if (feed) close(feed);
      unsubscribe();
    },
  };
}
