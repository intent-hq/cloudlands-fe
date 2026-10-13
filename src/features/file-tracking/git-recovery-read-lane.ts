import { rendererEventRecovery } from '$features/events/renderer-event-recovery';
import type { RecoveryLifetime } from '$shared/event-recovery/resource';
import type { GitReadTransport } from './components/diff/diff-ipc-batcher';

export const gitContentRecoveryKey = (workspaceId: string, readKey: string) =>
  `git-content:${JSON.stringify([workspaceId, readKey])}`;
export const secondaryRootRecoveryKey = (workspaceId: string, rootId: string) =>
  `git-secondary-root:${JSON.stringify([workspaceId, rootId])}`;

const transports = new Map<string, GitReadTransport>();
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
  pending.add(result);
  const done = () => {
    pending.delete(result);
  };
  void result.then(done, done);
  return result;
}
// Physical work survives a lease epoch change and cancellation of its caller.
const tails = new Map<string, Promise<unknown>>();
export function bindGitReadTransport(key: string, transport: GitReadTransport) {
  transports.set(key, transport);
  return () => {
    if (transports.get(key) === transport) transports.delete(key);
  };
}
export function serializeGitRead<T>(
  key: string,
  current: () => boolean,
  read: () => Promise<T>,
  wait = true,
): Promise<T> {
  const start = () => {
    if (!current()) throw new Error('Git read authority expired before dispatch');
    return read();
  };
  const tail = wait ? tails.get(key) : undefined;
  let result: Promise<T>;
  try {
    result = tail ? tail.then(start, start) : start();
  } catch (error) {
    result = Promise.reject(error);
  }
  tails.set(key, result);
  const done = () => {
    if (tails.get(key) === result) tails.delete(key);
  };
  void result.then(done, done);
  return result;
}
export function captureGitRead(key: string): {
  receipt: RecoveryLifetime;
  transport?: GitReadTransport;
  run<T>(read: () => Promise<T>): Promise<T>;
} {
  const receipt = rendererEventRecovery.capture(key);
  const transport = transports.get(key);
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
      );
      if (transport) trackGitRead(transport, result);
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
