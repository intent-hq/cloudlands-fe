/** Transport lifetime for the caller-authorized presence.focus channel (§6.9).
 * Domain projections belong to Redux; this adapter only orders wire frames. */
import { backendRequest, onBackendNotification } from '$lib/client/live/backend-transport';
import type { PresenceFocusItem } from '$shared/types/presence';

export interface FocusFrame {
  generation: number;
  seq: number;
  target: PresenceFocusItem | null;
}
export interface FocusSubscription {
  refresh(): Promise<FocusFrame | null>;
  close(): void;
}

type WireFrame = {
  subscriptionId: string;
  seq: number;
  target: PresenceFocusItem | null;
  closed?: true;
};
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const identifier = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

function parseFrame(params: unknown, workspaceId: string, principalId: string): WireFrame | null {
  if (!object(params) || params.kind !== 'snapshot' || !identifier(params.subscriptionId))
    return null;
  if (!Number.isSafeInteger(params.seq) || (params.seq as number) < 0) return null;
  const snapshot = params.snapshot;
  if (
    !object(snapshot) ||
    snapshot.workspaceId !== workspaceId ||
    snapshot.principalId !== principalId
  )
    return null;
  const target = snapshot.target;
  if (snapshot.closed !== undefined && snapshot.closed !== true) return null;
  if (snapshot.closed === true && target !== null) return null;
  if (target === null)
    return {
      subscriptionId: params.subscriptionId,
      seq: params.seq as number,
      target,
      ...(snapshot.closed === true ? { closed: true as const } : {}),
    };
  if (
    !object(target) ||
    !identifier(target.workspaceId) ||
    (target.agentId !== undefined && !identifier(target.agentId)) ||
    (target.noteId !== undefined && !identifier(target.noteId)) ||
    (target.agentId !== undefined && target.noteId !== undefined)
  )
    return null;
  return {
    subscriptionId: params.subscriptionId,
    seq: params.seq as number,
    target: {
      workspaceId: target.workspaceId,
      ...(target.agentId !== undefined ? { agentId: target.agentId as string } : {}),
      ...(target.noteId !== undefined ? { noteId: target.noteId as string } : {}),
    },
  };
}

/** Attach the listener before registering: seq-0 can race the subscribe reply.
 * Refresh is single-flight and replaces the same group. No polling/retry loop.
 * A gap fails closed and obtains one new snapshot; reconnect/admission is owned
 * by the surrounding saga, which disposes this whole lifetime. */
export function createPresenceFocusChannel(
  workspaceId: string,
  principalId: string,
  replaceGroup: string,
  onChange: (frame: FocusFrame | null) => void,
  isCurrent: () => boolean,
  canRelease: () => boolean,
): FocusSubscription {
  let closed = false;
  let generation = 0;
  let subscriptionId: string | undefined;
  let nextSeq = 0;
  let pending: Promise<FocusFrame | null> | undefined;
  let settle: ((frame: FocusFrame | null) => void) | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let beforeAck: WireFrame[] = [];
  let registering = false;
  let recoveredGap = false;

  const release = (id: string | undefined) => {
    if (id && canRelease())
      void backendRequest('presence.focus.unsubscribe', { workspaceId, subscriptionId: id }).catch(
        () => {},
      );
  };
  const finish = (frame: FocusFrame | null) => {
    if (timer) clearTimeout(timer);
    timer = undefined;
    const resolve = settle;
    settle = undefined;
    resolve?.(frame);
  };
  const invalidate = () => {
    onChange(null);
    release(subscriptionId);
    subscriptionId = undefined;
    finish(null);
  };
  const accept = (frame: WireFrame) => {
    if (closed || !isCurrent() || frame.subscriptionId !== subscriptionId) return;
    if (frame.seq < nextSeq) return;
    if (frame.closed) {
      closed = true;
      off();
      invalidate();
      return;
    }
    if (frame.seq !== nextSeq) {
      invalidate();
      // At most one gap recovery per lifetime, even for a broken server.
      if (!recoveredGap) {
        recoveredGap = true;
        void Promise.resolve(pending).then(() => refresh());
      }
      return;
    }
    nextSeq += 1;
    const update = { generation, seq: frame.seq, target: frame.target };
    onChange(update);
    finish(update);
  };
  const off = onBackendNotification(({ method, params }) => {
    if (closed || !isCurrent() || method !== 'subscription.push') return;
    const frame = parseFrame(params, workspaceId, principalId);
    if (!frame) {
      if (object(params) && params.subscriptionId === subscriptionId) invalidate();
      return;
    }
    if (registering) {
      // Bounded even if unrelated or obsolete registrations send a burst.
      if (beforeAck.length === 32) beforeAck.shift();
      beforeAck.push(frame);
    } else accept(frame);
  });

  function refresh(): Promise<FocusFrame | null> {
    if (closed || !isCurrent()) return Promise.resolve(null);
    if (pending) return pending;
    generation += 1;
    const lifetime = generation;
    onChange(null);
    release(subscriptionId);
    subscriptionId = undefined;
    nextSeq = 0;
    beforeAck = [];
    registering = true;
    const response = new Promise<FocusFrame | null>((resolve) => {
      settle = resolve;
      timer = setTimeout(() => {
        registering = false;
        invalidate();
      }, 10_000);
    });
    pending = response.finally(() => {
      pending = undefined;
    });
    void backendRequest<{ subscriptionId: string }>('presence.focus.subscribe', {
      workspaceId,
      principalId,
      replaceGroup,
    }).then(
      (reply) => {
        if (closed || !isCurrent() || generation !== lifetime || !settle) {
          release(reply?.subscriptionId);
          return;
        }
        if (!identifier(reply?.subscriptionId)) {
          registering = false;
          invalidate();
          return;
        }
        subscriptionId = reply.subscriptionId;
        registering = false;
        const queued = beforeAck;
        beforeAck = [];
        for (const frame of queued) accept(frame);
      },
      () => {
        if (closed || generation !== lifetime) return;
        registering = false;
        invalidate();
      },
    );
    return pending;
  }
  return {
    refresh,
    close() {
      closed = true;
      off();
      release(subscriptionId);
      subscriptionId = undefined;
      finish(null);
    },
  };
}
