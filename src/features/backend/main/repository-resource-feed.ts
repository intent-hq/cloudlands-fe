/** Explicit resource reads on one original physical connection. No inventory grant is reused. */
import { z } from 'zod';
import {
  RepositoryResourceCaptureSchema as captureSchema,
  RepositoryResourceNoticeSchema as noticeSchema,
  RepositoryResourceWorkspaceSchema as querySchema,
  RepositoryResourceRequestSchema,
  RepositoryResourceResultSchema,
  isRepositoryResourceResultFor,
  type RepositoryResourceTarget,
} from '$shared/types/repository-resource-read';
import { JsonRpcError } from './json-rpc-errors';
import type { JsonRpcClient, RepositoryConnection } from './json-rpc-client';

const CAPTURE = 'sourceControl.read.capture';
const READ = 'sourceControl.read.detail';
const RELEASE = 'sourceControl.read.release';
const RETIRED = 'sourceControl.read.retired';
const ACQUIRE_MS = 5_000;
// Local cleanup observer budget, not evidence that a server operation finished.
const CLEANUP_RESPONSE_MS = 15_000;
const LIMIT = 64;
const unavailable = () =>
  new JsonRpcError({
    code: -32003,
    message: 'Forbidden',
    // i18n-ignore (exact daemon ABI diagnostic, never displayed by the context facade)
    data: { code: 'forbidden', detail: 'Repository resource unavailable' },
  });

export function createRepositoryResourceFeed(client: JsonRpcClient) {
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
    if (notice.terminal && notice.allRetired && notice.readLifetimeIds.length === 0) {
      // Terminal may supersede queued increments; MAX is terminal even at equal cursor.
      close(current);
      return;
    }
    if (
      notice.terminal ||
      notice.allRetired ||
      notice.readLifetimeIds.length === 0 ||
      new Set(notice.readLifetimeIds).size !== notice.readLifetimeIds.length
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
      for (const id of notice.readLifetimeIds) acquisition.retired.add(id);
      if (acquisition.retired.size > LIMIT) {
        close(current);
        return;
      }
    }
    for (const lease of [...current.leases])
      if (notice.readLifetimeIds.includes(lease.id)) lease.retire();
    for (const acquisition of current.pending) acquisition.wake?.();
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
  function release(
    connection: RepositoryConnection,
    query: z.infer<typeof querySchema>,
    id: string,
    producer?: object,
    readDone?: Promise<void>,
    terminal?: () => void,
  ) {
    // This path deliberately has no ensureConnected/retry/fallback.
    const cleanup = requestOriginal(
      connection,
      RELEASE,
      { ...query, readLifetimeId: id },
      { timeoutMs: 5_000 },
      producer,
    )
      .then((value) => {
        z.object({ released: z.literal(true) })
          .strict()
          .parse(value);
      })
      .catch(() => {
        /* Original session gone: daemon expiry/disconnect owns cleanup. */
      });
    if (producer)
      void cleanup.then(() => {
        if (readDone) void readDone.then(() => terminal?.());
        else terminal?.();
      });
  }

  async function capture(connection: object, workspaceId: string) {
    const original = client.getRepositoryConnection();
    const current = feed;
    if (
      disposed ||
      !original ||
      original !== connection ||
      !original.repositoryResourceRead ||
      !current ||
      current.incarnation !== original.incarnation ||
      current.dead ||
      current.pending.size + current.leases.size >= LIMIT
    )
      throw unavailable();
    const query = Object.freeze(querySchema.parse({ workspaceId }));
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

    const work = requestOriginal(
      original,
      CAPTURE,
      query,
      { timeoutMs: CLEANUP_RESPONSE_MS },
      producer,
    )
      .then(async (raw) => {
        // A malformed response can still name a lease requiring original-session disposal.
        const reference = z
          .object({ readLifetimeId: captureSchema.shape.readLifetimeId })
          .safeParse(raw);
        if (reference.success) knownId = reference.data.readLifetimeId;
        const result = captureSchema.parse(raw);
        const cursor = BigInt(result.retirementSequence);
        while (valid() && current.cursor < cursor) {
          await new Promise<void>((resolve) => {
            acquisition.wake = resolve;
          });
          acquisition.wake = undefined;
        }
        if (
          !valid() ||
          acquisition.retired.has(result.readLifetimeId) ||
          Date.now() >= started + result.expiresAfterMs
        )
          throw unavailable();
        let retired = false;
        let reads = 0;
        let inFlight = false;
        let readDone: Promise<void> | undefined;
        const listeners = new Set<() => void>();
        const lease: Lease = {
          id: result.readLifetimeId,
          connection: original,
          retire() {
            if (retired) return;
            retired = true;
            clearTimeout(expiry);
            current.leases.delete(lease);
            release(original, query, result.readLifetimeId, producer, readDone, cleanupFinished);
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
        current.leases.add(lease);
        const expiry = setTimeout(() => lease.retire(), Math.max(0, expiresAt - Date.now()));
        expiry.unref();
        owned = true;
        return {
          capture: result,
          expiresAt,
          isCurrent,
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
          async detail(targetInput: RepositoryResourceTarget, refresh = false) {
            const { target } = RepositoryResourceRequestSchema.parse({
              target: targetInput,
              refresh,
            });
            if (
              !isCurrent() ||
              inFlight ||
              !result.instances.some(
                (instance) => instance.instanceBaseUrl === target.repository.instanceBaseUrl,
              )
            )
              throw unavailable();
            if (reads >= LIMIT) {
              lease.retire();
              throw unavailable();
            }
            reads += 1;
            inFlight = true;
            let joined: (() => void) | undefined;
            if (producer)
              readDone = new Promise<void>((resolve) => {
                joined = resolve;
              });
            try {
              const rawContext = await requestOriginal(
                original,
                READ,
                { ...query, readLifetimeId: result.readLifetimeId, target, refresh },
                { timeoutMs: 15_000 },
                producer,
              );
              const response = RepositoryResourceResultSchema.parse(rawContext);
              if (!isCurrent() || !isRepositoryResourceResultFor(response, result, target))
                throw unavailable();
              return response;
            } catch (error) {
              lease.retire();
              throw error;
            } finally {
              inFlight = false;
              joined?.();
            }
          },
        };
      })
      .finally(() => {
        current.pending.delete(acquisition);
        if (knownId && !owned)
          release(original, query, knownId, producer, undefined, cleanupFinished);
        else if (!owned) cleanupFinished();
      });
    // Attach disposal before racing: a late successful acquisition is never published.
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
