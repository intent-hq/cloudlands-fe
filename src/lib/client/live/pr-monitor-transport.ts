import { z } from 'zod';
import { IPC_CHANNELS } from '$shared/ipc-registry';
import {
  PrMonitorOriginSchema,
  supportsReviewMonitoring,
  type PrMonitorSession,
} from '$shared/types/pr-monitor';
import { BackendError } from './backend-transport-types';

/** One bridge/document/socket lifetime. Never fall back to current-backend routing. */
export function createPrMonitorTransport(
  getBridge: () => Window['electronAPI'] | undefined,
  recipient: { reviewMonitoring?: number } = {},
) {
  const channels = IPC_CHANNELS.BACKEND.PR_MONITOR;
  return async (workspaceId: string): Promise<PrMonitorSession> => {
    const bridge = getBridge();
    const unavailable = () =>
      new BackendError({
        code: 'PR_MONITOR_SESSION_RETIRED',
        message: 'Monitor connection unavailable',
      });
    if (!bridge) throw unavailable();
    const version =
      supportsReviewMonitoring(recipient.reviewMonitoring) &&
      supportsReviewMonitoring(bridge.reviewMonitoring)
        ? Math.min(recipient.reviewMonitoring!, bridge.reviewMonitoring!)
        : undefined;
    let id: string | undefined;
    let retired = false;
    let released = false;
    const early = new Set<string>();
    const retirementListeners = new Set<() => void>();
    const notifications = new Set<Parameters<PrMonitorSession['onNotification']>[0]>();
    const retire = () => {
      if (retired) return;
      retired = true;
      for (const listener of [...retirementListeners]) listener();
      retirementListeners.clear();
    };
    const retiredListener = bridge.on(channels.RETIRED, (raw: unknown) => {
      const notice = z.object({ id: z.string() }).safeParse(raw);
      if (!notice.success) return retire();
      if (!id) {
        early.add(notice.data.id);
        if (early.size > 256) retire();
      } else if (notice.data.id === id) retire();
    });
    const notificationListener = bridge.on(channels.NOTIFICATION, (raw: unknown) => {
      const notice = z
        .object({
          id: z.string(),
          notification: z.object({ method: z.string(), params: z.unknown().optional() }),
        })
        .safeParse(raw);
      if (!retired && getBridge() === bridge && notice.success && notice.data.id === id)
        for (const listener of notifications) listener(notice.data.notification);
    });
    const unwrap = (value: unknown) => {
      const response = z
        .object({
          ok: z.boolean(),
          result: z.unknown().optional(),
          error: z
            .object({
              code: z.string(),
              message: z.string(),
              rpcCode: z.number().optional(),
              data: z.unknown().optional(),
            })
            .optional(),
        })
        .parse(value);
      if (!response.ok) throw response.error ? new BackendError(response.error) : unavailable();
      return response.result;
    };
    const release = async () => {
      if (released) return;
      released = true;
      retire();
      bridge.offById(channels.RETIRED, retiredListener);
      bridge.offById(channels.NOTIFICATION, notificationListener);
      if (id)
        try {
          await bridge.invoke(channels.RELEASE, { id, workspaceId });
        } catch {
          /* Original main owns cleanup. */
        }
    };
    try {
      const result = z
        .object({
          origin: PrMonitorOriginSchema,
          support: z.enum(['supported', 'unsupported', 'consumer-pending']),
        })
        .parse(
          unwrap(
            await bridge.invoke(channels.CAPTURE, {
              workspaceId,
              ...(version === undefined ? {} : { reviewMonitoring: version }),
            }),
          ),
        );
      id = result.origin.sessionId;
      if (early.has(id) || getBridge() !== bridge) retire();
      if (retired || result.origin.workspaceId !== workspaceId) throw unavailable();
      return {
        ...result,
        onNotification(handler) {
          notifications.add(handler);
          return () => {
            notifications.delete(handler);
          };
        },
        onRetired(handler) {
          if (retired) {
            handler();
            return () => {};
          }
          retirementListeners.add(handler);
          return () => {
            retirementListeners.delete(handler);
          };
        },
        async request<T>(
          method: Parameters<PrMonitorSession['request']>[0],
          params: Record<string, unknown>,
        ): Promise<T> {
          if (getBridge() !== bridge) retire();
          if (retired || params.workspaceId !== workspaceId) throw unavailable();
          const response = await bridge.invoke(channels.REQUEST, {
            id,
            workspaceId,
            method,
            params,
          });
          if (getBridge() !== bridge) retire();
          if (retired) throw unavailable();
          return unwrap(response) as T;
        },
        release,
      };
    } catch (error) {
      await release();
      throw error;
    }
  };
}
