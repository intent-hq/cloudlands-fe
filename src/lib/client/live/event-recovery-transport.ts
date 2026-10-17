import { z } from 'zod';
import { IPC_CHANNELS } from '$shared/ipc-registry';
import {
  createEventRecoverySession,
  type EventRecoverySession,
  type RecoveryNotification,
} from '$shared/event-recovery/session';
import { BackendError } from './backend-transport-types';

const frameSchema = z.discriminatedUnion('kind', [
  z.object({ id: z.string(), kind: z.literal('retired') }),
  z.object({
    id: z.string(),
    kind: z.literal('notification'),
    notification: z.object({ method: z.string(), params: z.unknown().optional() }),
  }),
  z.object({ id: z.string(), kind: z.literal('reply'), replyId: z.string(), result: z.unknown() }),
]);
type Frame = z.infer<typeof frameSchema>;
const resultSchema = z.object({ ok: z.literal(true), result: z.unknown() });
function unwrap(value: unknown): unknown {
  const parsed = resultSchema.safeParse(value);
  if (parsed.success) return parsed.data.result;
  const error = z
    .object({
      error: z.object({
        code: z.string(),
        message: z.string(),
        rpcCode: z.number().optional(),
        data: z.unknown().optional(),
      }),
    })
    .safeParse(value);
  throw new BackendError(
    error.success
      ? error.data.error
      : { code: 'EVENT_RECOVERY_UNAVAILABLE', message: 'EVENT_RECOVERY_UNAVAILABLE' },
  );
}

/** One original preload document and opaque, main-owned connection reference. */
export function createEventRecoveryTransport(getBridge: () => Window['electronAPI'] | undefined) {
  return async (): Promise<EventRecoverySession> => {
    const bridge = getBridge();
    if (!bridge) throw new Error('Event recovery bridge unavailable');
    const channels = IPC_CHANNELS.BACKEND.EVENT_RECOVERY;
    let id: string | undefined,
      retired = false,
      released = false,
      sequence = 0;
    const early: Frame[] = [];
    const notifications = new Set<(n: RecoveryNotification) => void>(),
      retirees = new Set<() => void>();
    const pending = new Map<
      string,
      { receive: (result: unknown) => void; reject: (error: Error) => void }
    >();
    const retire = () => {
      if (retired) return;
      retired = true;
      for (const row of pending.values()) row.reject(new Error('Event recovery retired'));
      pending.clear();
      for (const fn of [...retirees]) fn();
      retirees.clear();
    };
    const process = (frame: Frame) => {
      if (frame.id !== id) return;
      if (frame.kind === 'retired') retire();
      else if (!retired && frame.kind === 'notification')
        for (const fn of notifications) fn(frame.notification);
      else if (!retired && frame.kind === 'reply')
        pending.get(frame.replyId)?.receive(frame.result);
    };
    const listener = bridge.on(channels.FRAME, (value: unknown) => {
      const parsed = frameSchema.safeParse(value);
      if (!parsed.success) return;
      if (!id) {
        if (early.length >= 64) {
          early.length = 0;
          retire();
        } else if (!retired) early.push(parsed.data);
      } else process(parsed.data);
    });
    const dispose = () => {
      if (released) return;
      released = true;
      retire();
      bridge.offById(channels.FRAME, listener);
      if (id) void bridge.invoke(channels.RELEASE, { id }).catch(() => {});
    };
    const current = () => {
      if (getBridge() !== bridge) retire();
      return !retired && !released;
    };
    try {
      const capture = z
        .object({ id: z.string().min(1), supported: z.boolean() })
        .parse(unwrap(await bridge.invoke(channels.CAPTURE)));
      id = capture.id;
      for (const frame of early) process(frame);
      early.length = 0;
      if (!current()) throw new Error('Event recovery capture retired');
      return createEventRecoverySession({
        supported: capture.supported,
        isCurrent: current,
        onRetired: (handler) => {
          retirees.add(handler);
          return () => {
            retirees.delete(handler);
          };
        },
        onNotification: (handler) => {
          notifications.add(handler);
          return () => {
            notifications.delete(handler);
          };
        },
        request: (method, params, observe) => {
          if (!current()) return Promise.reject(new Error('Event recovery retired'));
          if (!observe) return bridge.invoke(channels.REQUEST, { id, method, params }).then(unwrap);
          const replyId = String(++sequence);
          return new Promise((resolve, reject) => {
            const finish = (error?: Error, result?: unknown) => {
              pending.delete(replyId);
              if (error) reject(error);
              else resolve(result);
            };
            // Session deadlines suspend recovery. Only an actual ordered reply,
            // invoke failure or retirement settles this physical driver request.
            pending.set(replyId, {
              receive: (result) => {
                try {
                  observe(result);
                  finish(undefined, result);
                } catch (error) {
                  finish(error as Error);
                }
              },
              reject: (error) => finish(error),
            });
            void bridge.invoke(channels.REQUEST, { id, method, params, replyId }).then(
              (value) => {
                try {
                  unwrap(value);
                } catch (error) {
                  finish(error as Error);
                }
              },
              (error) => finish(error as Error),
            );
          });
        },
        dispose,
      });
    } catch (error) {
      dispose();
      throw error;
    }
  };
}

/** Register before initial capture; main replays ready state after installing the watch. */
export function onElectronEventRecoveryReady(
  getBridge: () => Window['electronAPI'] | undefined,
  handler: () => void,
): () => void {
  const bridge = getBridge();
  if (!bridge) return () => {};
  const channels = IPC_CHANNELS.BACKEND.EVENT_RECOVERY;
  const id = crypto.randomUUID();
  let stopped = false;
  const listener = bridge.on(channels.READY, (value: unknown) => {
    if (!stopped && getBridge() === bridge && (value as { id?: unknown } | null)?.id === id)
      handler();
  });
  // Invoke ordering guarantees an immediate dispose follows WATCH on this sender.
  void bridge.invoke(channels.WATCH_READY, { id }).catch(() => {});
  return () => {
    if (stopped) return;
    stopped = true;
    bridge.offById(channels.READY, listener);
    void bridge.invoke(channels.UNWATCH_READY, { id }).catch(() => {});
  };
}
