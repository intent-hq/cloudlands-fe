/** Original-connection repository reads. Daemon references never confer authority. */
import { z } from 'zod';
import {
  ExecutionScopeSchema,
  RepositoryContextRevisionSchema,
  RepositoryContextSchema,
  isRepositoryContextForRequest,
  sameExecutionScope,
  type RepositoryRootIdentity,
} from '$shared/types/repository-context';
import { JsonRpcError } from './json-rpc-errors';
import type { JsonRpcClient, RepositoryConnection } from './json-rpc-client';

const counter = RepositoryContextRevisionSchema.shape.sequence;
const querySchema = z
  .object({ workspaceId: z.string().min(1), gitRootId: z.string().min(1).optional() })
  .strict();
const captureSchema = z
  .object({
    lifetimeId: z.string().min(1).max(4096),
    scope: ExecutionScopeSchema.strict(),
    coverage: z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('workspaceInventory'), workspaceId: z.string().min(1) }).strict(),
      z
        .object({
          kind: z.literal('registeredRoot'),
          workspaceId: z.string().min(1),
          gitRootId: z.string().min(1),
        })
        .strict(),
    ]),
    retirementSequence: counter,
    expiresAfterMs: z.number().int().positive().max(300_000),
  })
  .strict();
const noticeSchema = z
  .object({
    lifetimeIds: z.array(z.string().min(1).max(4096)).max(64),
    sequence: counter,
    allRetired: z.boolean(),
    terminal: z.boolean(),
  })
  .strict();
const CAPTURE = 'workspace.repositoryContext.capture';
const READ = 'workspace.repositoryContext';
const RELEASE = 'workspace.repositoryContext.release';
const RETIRED = 'workspace.repositoryContext.retired';
const ACQUIRE_MS = 5_000;
// Local cleanup observer budget, not evidence that a server operation finished.
const CLEANUP_RESPONSE_MS = 35_000;
const LIMIT = 64;
const unavailable = () =>
  new JsonRpcError({
    code: -32003,
    message: 'Forbidden',
    // i18n-ignore (exact daemon ABI diagnostic, never displayed by the context facade)
    data: { code: 'forbidden', detail: 'Repository context unavailable' },
  });

export function createRepositoryAuthorityFeed(client: JsonRpcClient) {
  type Acquisition = {
    connection: RepositoryConnection;
    retired: Set<string>;
    abandoned: boolean;
    wake?: () => void;
  };
  type Lease = {
    id: string;
    connection: RepositoryConnection;
    retire(): void;
  };
  type Feed = {
    incarnation: object;
    cursor: bigint;
    last: string | null;
    dead: boolean;
    pending: Set<Acquisition>;
    leases: Set<Lease>;
  };
  let feed: Feed | undefined;
  let disposed = false;

  function close(current: Feed) {
    current.dead = true;
    for (const acquisition of current.pending) {
      acquisition.abandoned = true;
      acquisition.wake?.();
    }
    for (const lease of [...current.leases]) lease.retire();
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
        leases: new Set(),
      };
      return;
    }
    const current = feed;
    if (!current) return;
    if (event.type === 'identity-retired') {
      for (const acquisition of current.pending) {
        if (acquisition.connection === event.connection) {
          acquisition.abandoned = true;
          acquisition.wake?.();
        }
      }
      for (const lease of [...current.leases])
        if (lease.connection === event.connection) lease.retire();
      return;
    }
    if (event.incarnation !== current.incarnation) return;
    if (event.type === 'closed') {
      close(current);
      return;
    }
    if (event.notification.method !== RETIRED || current.dead) return;
    const parsed = noticeSchema.safeParse(event.notification.params);
    if (!parsed.success) {
      close(current);
      return;
    }
    const notice = parsed.data;
    if (notice.terminal && notice.allRetired && notice.lifetimeIds.length === 0) {
      // Terminal may supersede queued increments; MAX is terminal even at equal cursor.
      close(current);
      return;
    }
    if (
      notice.terminal ||
      notice.allRetired ||
      notice.lifetimeIds.length === 0 ||
      new Set(notice.lifetimeIds).size !== notice.lifetimeIds.length
    ) {
      close(current);
      return;
    }
    const sequence = BigInt(notice.sequence);
    const fingerprint = JSON.stringify(notice);
    if (sequence === current.cursor && fingerprint === current.last) return;
    if (sequence !== current.cursor + 1n) {
      close(current);
      return;
    }
    current.cursor = sequence;
    current.last = fingerprint;
    for (const acquisition of current.pending) {
      for (const id of notice.lifetimeIds) acquisition.retired.add(id);
      if (acquisition.retired.size > LIMIT) {
        close(current);
        return;
      }
    }
    for (const lease of [...current.leases])
      if (notice.lifetimeIds.includes(lease.id)) lease.retire();
    for (const acquisition of current.pending) acquisition.wake?.();
  });

  function release(
    connection: RepositoryConnection,
    query: z.infer<typeof querySchema>,
    id: string,
  ) {
    // This path deliberately has no ensureConnected/retry/fallback.
    void client
      .requestOnCapturedConnection(
        connection,
        RELEASE,
        { ...query, repositoryLifetimeId: id },
        { timeoutMs: 5_000 },
      )
      .then((value) => {
        z.object({ released: z.literal(true) })
          .strict()
          .parse(value);
      })
      .catch(() => {
        /* Original session gone: daemon expiry/disconnect owns cleanup. */
      });
  }

  async function capture(connection: object, root: Readonly<RepositoryRootIdentity>) {
    const original = client.getRepositoryConnection();
    const current = feed;
    if (
      disposed ||
      !original ||
      original !== connection ||
      !original.repositoryContext ||
      !current ||
      current.incarnation !== original.incarnation ||
      current.dead ||
      current.pending.size + current.leases.size >= LIMIT
    )
      throw unavailable();
    const query = Object.freeze(
      querySchema.parse({
        workspaceId: root.workspaceId,
        ...(root.kind === 'registered' ? { gitRootId: root.gitRootId } : {}),
      }),
    );
    const started = Date.now();
    const acquisition: Acquisition = { connection: original, retired: new Set(), abandoned: false };
    current.pending.add(acquisition);
    let delivered = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let knownId: string | undefined;
    let owned = false;
    const valid = () =>
      !disposed &&
      !current.dead &&
      !acquisition.abandoned &&
      client.getRepositoryConnection() === original;

    const work = client
      .requestOnCapturedConnection(original, CAPTURE, query, { timeoutMs: CLEANUP_RESPONSE_MS })
      .then(async (raw) => {
        // A malformed response can still name a lease requiring original-session disposal.
        const reference = z.object({ lifetimeId: captureSchema.shape.lifetimeId }).safeParse(raw);
        if (reference.success) knownId = reference.data.lifetimeId;
        const result = captureSchema.parse(raw);
        if (
          result.coverage.workspaceId !== query.workspaceId ||
          (query.gitRootId === undefined
            ? result.coverage.kind !== 'workspaceInventory'
            : result.coverage.kind !== 'registeredRoot' ||
              result.coverage.gitRootId !== query.gitRootId)
        )
          throw unavailable();
        const cursor = BigInt(result.retirementSequence);
        while (valid() && current.cursor < cursor) {
          await new Promise<void>((resolve) => {
            acquisition.wake = resolve;
          });
          acquisition.wake = undefined;
        }
        if (
          !valid() ||
          acquisition.retired.has(result.lifetimeId) ||
          Date.now() >= started + result.expiresAfterMs
        )
          throw unavailable();
        let retired = false;
        let reads = 0;
        let inFlight = false;
        const listeners = new Set<() => void>();
        const lease: Lease = {
          id: result.lifetimeId,
          connection: original,
          retire() {
            if (retired) return;
            retired = true;
            clearTimeout(expiry);
            current.leases.delete(lease);
            release(original, query, result.lifetimeId);
            for (const listener of [...listeners]) {
              try {
                listener();
              } catch {
                /* Continue retiring other resource owners. */
              }
            }
            listeners.clear();
          },
        };
        const expiresAt = started + result.expiresAfterMs;
        const isCurrent = () => {
          if (
            !retired &&
            (disposed ||
              current.dead ||
              Date.now() >= expiresAt ||
              client.getRepositoryConnection() !== original)
          )
            lease.retire();
          return !retired;
        };
        const allowsRequest = (method: string, params: Readonly<Record<string, unknown>>) => {
          const parsed = querySchema.safeParse(params);
          return (
            method === READ &&
            parsed.success &&
            parsed.data.workspaceId === query.workspaceId &&
            parsed.data.gitRootId === query.gitRootId
          );
        };
        current.leases.add(lease);
        const expiry = setTimeout(() => lease.retire(), Math.max(0, expiresAt - Date.now()));
        expiry.unref();
        owned = true;
        return {
          stamp: Object.freeze({}),
          expiresAt,
          isCurrent,
          allowsRequest,
          onRetired(listener: () => void) {
            if (!isCurrent()) {
              listener();
              return () => {};
            }
            listeners.add(listener);
            return () => {
              listeners.delete(listener);
            };
          },
          dispose: () => lease.retire(),
          async request(method: string, params: Readonly<Record<string, unknown>>) {
            if (!isCurrent() || !allowsRequest(method, params) || inFlight) throw unavailable();
            if (reads >= LIMIT) {
              lease.retire();
              throw unavailable();
            }
            reads += 1;
            inFlight = true;
            try {
              const rawContext = await client.requestOnCapturedConnection(
                original,
                READ,
                { ...query, repositoryLifetimeId: result.lifetimeId },
                { timeoutMs: 10_000 },
              );
              const context = RepositoryContextSchema.parse(rawContext);
              if (
                !sameExecutionScope(context.scope, result.scope) ||
                context.revision.epoch !== result.lifetimeId ||
                context.revision.sequence !== '1' ||
                context.roots.length > 128 ||
                !isRepositoryContextForRequest(context, query)
              )
                throw unavailable();
              return context;
            } catch (error) {
              lease.retire();
              throw error;
            } finally {
              inFlight = false;
            }
          },
        };
      })
      .finally(() => {
        current.pending.delete(acquisition);
        if (knownId && !owned) release(original, query, knownId);
      });
    // Attach disposal before racing: a late successful acquisition is never published.
    void work.then(
      (lifetime) => {
        if (acquisition.abandoned) lifetime.dispose();
      },
      () => {},
    );
    try {
      const lifetime = await Promise.race([
        work,
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => {
            acquisition.abandoned = true;
            acquisition.wake?.();
            reject(unavailable());
          }, ACQUIRE_MS);
          timer.unref();
        }),
      ]);
      delivered = true;
      return lifetime;
    } finally {
      clearTimeout(timer);
      if (!delivered) {
        acquisition.abandoned = true;
        acquisition.wake?.();
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
