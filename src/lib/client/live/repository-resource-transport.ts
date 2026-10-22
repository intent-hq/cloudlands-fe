import { z } from 'zod';
import { IPC_CHANNELS } from '$shared/ipc-registry';
import {
  RepositoryResourceCaptureSchema,
  RepositoryResourceResultSchema,
  RepositoryResourceRequestSchema,
  RepositoryResourceWorkspaceSchema,
  isRepositoryResourceResultFor,
  type RepositoryResourceSession,
} from '$shared/types/repository-resource-read';
import { BackendError } from './backend-transport-types';

/** Captures the actual preload bridge once. There is no generic request fallback. */
export function createRepositoryResourceTransport(
  getBridge: () => Window['electronAPI'] | undefined,
) {
  const channels = IPC_CHANNELS.BACKEND.REPOSITORY_RESOURCE;
  const unavailable = () =>
    new BackendError({
      code: 'REPOSITORY_RESOURCE_UNAVAILABLE',
      message: 'REPOSITORY_RESOURCE_UNAVAILABLE',
    });
  const unwrap = (value: unknown) => {
    const parsed = z
      .object({ ok: z.literal(true), result: z.unknown() })
      .strict()
      .safeParse(value);
    if (!parsed.success) throw unavailable();
    return parsed.data.result;
  };
  return async (workspaceId: string): Promise<RepositoryResourceSession> => {
    const query = RepositoryResourceWorkspaceSchema.parse({ workspaceId });
    const bridge = getBridge();
    if (!bridge) throw unavailable();
    let id: string | undefined;
    let retired = false,
      released = false;
    const early = new Set<string>(),
      listeners = new Set<() => void>();
    const retire = () => {
      if (retired) return;
      retired = true;
      for (const listener of [...listeners]) {
        try {
          listener();
        } catch {
          /* Notify all owners. */
        }
      }
      listeners.clear();
    };
    const listenerId = bridge.on(channels.RETIRED, (raw: unknown) => {
      const notice = z
        .object({ id: z.string().min(1).max(128) })
        .strict()
        .safeParse(raw);
      if (!notice.success) {
        retire();
        return;
      }
      if (id === undefined) {
        early.add(notice.data.id);
        if (early.size > 64) {
          early.clear();
          retire();
        }
      } else if (id === notice.data.id) retire();
    });
    const release = async () => {
      if (released) return;
      released = true;
      retire();
      bridge.offById(channels.RETIRED, listenerId);
      if (id) {
        try {
          await bridge.invoke(channels.RELEASE, { ...query, id });
        } catch {
          /* The original main document and daemon own bounded cleanup. */
        }
      }
    };
    const isCurrent = () => {
      if (getBridge() !== bridge) retire();
      return !retired && !released;
    };
    try {
      const raw = unwrap(await bridge.invoke(channels.CAPTURE, query));
      const known = z.object({ id: z.string().min(1).max(128) }).safeParse(raw);
      if (known.success) id = known.data.id;
      const result = z
        .object({ id: z.string().min(1).max(128), capture: RepositoryResourceCaptureSchema })
        .strict()
        .parse(raw);
      id = result.id;
      if (early.has(id)) retire();
      early.clear();
      if (!isCurrent()) throw unavailable();
      const capture = result.capture;
      return {
        capture,
        onRetired(listener) {
          if (!isCurrent()) {
            listener();
            return () => {};
          }
          listeners.add(listener);
          return () => {
            listeners.delete(listener);
          };
        },
        async detail(targetInput, refresh = false) {
          if (!isCurrent()) throw unavailable();
          const { target } = RepositoryResourceRequestSchema.parse({
            target: targetInput,
            refresh,
          });
          try {
            const value = RepositoryResourceResultSchema.parse(
              unwrap(await bridge.invoke(channels.DETAIL, { ...query, id, target, refresh })),
            );
            if (!isCurrent() || !isRepositoryResourceResultFor(value, capture, target))
              throw unavailable();
            return value;
          } catch {
            await release();
            throw unavailable();
          }
        },
        release,
      };
    } catch (error) {
      await release();
      throw error;
    }
  };
}
