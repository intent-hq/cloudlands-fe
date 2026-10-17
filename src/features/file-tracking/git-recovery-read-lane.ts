import { getPhysicalRequestCompletion } from '$shared/event-recovery/session';
import { rendererEventRecovery } from '$features/events/renderer-event-recovery';
import type { RecoveryLifetime } from '$shared/event-recovery/resource';
import type { GitReadTransport } from './components/diff/diff-ipc-batcher';

export const gitContentRecoveryKey = (workspaceId: string, readKey: string) =>
  `git-content:${JSON.stringify([workspaceId, readKey])}`;
export const secondaryRootRecoveryKey = (workspaceId: string, rootId: string) =>
  `git-secondary-root:${JSON.stringify([workspaceId, rootId])}`;

const transports = new Map<string, GitReadTransport>();
const failures = new Map<string, (error: unknown) => void>();

/** Logical rejection does not release physical ownership, including nested deadlines. */
export async function gitReadFailureDrained(error: unknown): Promise<void> {
  const physical = getPhysicalRequestCompletion(error);
  if (!physical) return;
  const completion = await physical;
  if (!completion.retired) await Promise.all(completion.errors.map(gitReadFailureDrained));
}
export function gitReadDrained(result: Promise<unknown>, release?: () => void): Promise<void> {
  return result.then(
    () => {
      release?.();
    },
    (error) => {
      if (getPhysicalRequestCompletion(error))
        return gitReadFailureDrained(error).then(() => {
          release?.();
        });
      release?.();
    },
  );
}
export function observeGitReadFailure<T>(
  result: Promise<T>,
  failed?: (error: unknown) => void,
): Promise<T> {
  const observe = (error: unknown) => {
    failed?.(error);
    const physical = getPhysicalRequestCompletion(error);
    if (physical)
      void physical.then((completion) => {
        if (!completion.retired) for (const late of completion.errors) observe(late);
      });
  };
  return result.catch((error) => {
    observe(error);
    throw error;
  });
}

const pendingByTransport = new WeakMap<object, Set<Promise<unknown>>>();
export async function waitForGitReads(transport: GitReadTransport): Promise<void> {
  await Promise.allSettled([...(pendingByTransport.get(transport.key) ?? [])]);
}
export function trackGitRead<T>(transport: GitReadTransport, result: Promise<T>): Promise<T> {
  let pending = pendingByTransport.get(transport.key);
  if (!pending) {
    pending = new Set();
    pendingByTransport.set(transport.key, pending);
  }
  const drained = gitReadDrained(result);
  pending.add(drained);
  const done = () => {
    pending.delete(drained);
  };
  void drained.then(done, done);
  return result;
}
// Physical work survives a lease epoch change and cancellation of its caller.
const sessionTails = new WeakMap<object, Map<string, Promise<unknown>>>();
export function bindGitReadTransport(
  key: string,
  transport: GitReadTransport,
  onFailure?: (error: unknown) => void,
) {
  transports.set(key, transport);
  if (onFailure) failures.set(key, onFailure);
  else failures.delete(key);
  return () => {
    if (transports.get(key) === transport) {
      transports.delete(key);
      failures.delete(key);
    }
  };
}
export function serializeGitRead<T>(
  key: string,
  current: () => boolean,
  read: () => Promise<T>,
  wait = true,
  physicalReads?: Set<Promise<void>>,
  physicalSession = rendererEventRecovery.capturePhysicalSessionIdentity(),
): Promise<T> {
  const tails = sessionTails.get(physicalSession) ?? new Map<string, Promise<unknown>>();
  sessionTails.set(physicalSession, tails);
  const start = () => {
    if (physicalSession !== rendererEventRecovery.capturePhysicalSessionIdentity() || !current())
      throw new Error('Git read authority expired before dispatch');
    return read();
  };
  const tail = wait ? tails.get(key) : undefined;
  let result: Promise<T>;
  try {
    result = tail ? tail.then(start, start) : start();
  } catch (error) {
    result = Promise.reject(error);
  }
  const drained = drainCapturedGitRead(result, physicalReads);
  tails.set(key, drained);
  const done = () => {
    if (tails.get(key) === drained) tails.delete(key);
  };
  void drained.then(done, done);
  return result;
}
function drainCapturedGitRead(result: Promise<unknown>, physicalReads?: Set<Promise<void>>) {
  const drained = gitReadDrained(result);
  return physicalReads
    ? drained.then(async () => {
        await Promise.all([...physicalReads]);
      })
    : drained;
}
export function captureGitRead(key: string): {
  receipt: RecoveryLifetime;
  transport?: GitReadTransport;
  run<T>(read: () => Promise<T>): Promise<T>;
} {
  const physicalSession = rendererEventRecovery.capturePhysicalSessionIdentity();
  const receipt = rendererEventRecovery.capture(key);
  const authority = rendererEventRecovery.captureAuthority(key);
  const bound = transports.get(key);
  const failed = failures.get(key);
  const physicalReads = new Set<Promise<void>>();
  const transport = bound && {
    ...bound,
    request: <T>(method: string, params?: unknown): Promise<T> => {
      if (!receipt.isCurrent())
        return Promise.reject(new Error('Git read authority expired before request'));
      const result = observeGitReadFailure(bound.request<T>(method, params), (error) => {
        if (authority.isCurrent()) failed?.(error);
      });
      const drained = gitReadDrained(result);
      physicalReads.add(drained);
      void drained.then(() => {
        physicalReads.delete(drained);
      });
      return result;
    },
    onFailure: (error: unknown) => {
      if (authority.isCurrent()) failed?.(error);
    },
  };
  return {
    receipt,
    transport,
    run: (read) => {
      if (!receipt.commit(() => undefined))
        return Promise.reject(new Error('Git read authority expired before enqueue'));
      const result = serializeGitRead(
        key,
        () => receipt.commit(() => undefined),
        read,
        !!transport,
        physicalReads,
        physicalSession,
      );
      if (transport) trackGitRead(transport, drainCapturedGitRead(result, physicalReads));
      return result;
    },
  };
}

export const chatContentRecoveryKey = (
  wsId: string,
  id: string,
  resourceKey: string,
  requestId: string,
) => `chat-content:${JSON.stringify([wsId, id, resourceKey, requestId])}`;

const rootKeys = new WeakMap<
  object,
  Map<string, { current(): boolean; ordinary: object; recovery: object }>
>();
/** Content and chat viewers of the same admitted root share physical batch identity. */
export function gitRootTransportKeys(scope: object, rootKey: string, current: () => boolean) {
  let roots = rootKeys.get(scope);
  if (!roots) {
    roots = new Map();
    rootKeys.set(scope, roots);
  }
  let keys = roots.get(rootKey);
  if (!keys?.current()) {
    keys = { current, ordinary: {}, recovery: {} };
    roots.set(rootKey, keys);
  }
  return keys;
}
