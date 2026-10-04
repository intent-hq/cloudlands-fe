import { z } from 'zod';
import { IPC_CHANNELS } from '$shared/ipc-registry';
import {
  CheckoutCaptureQuerySchema,
  CheckoutCaptureSchema,
  CheckoutPageQuerySchema,
  CheckoutProjectQuerySchema,
  CheckoutBranchesQuerySchema,
  CheckoutSelectionSchema,
  CheckoutProjectsSchema,
  CheckoutProjectDetailSchema,
  CheckoutBranchesSchema,
  CheckoutWarmSchema,
  checkoutResultSchema,
  parseCheckoutResult,
  type CheckoutCaptureQuery,
  type CheckoutResult,
  type RepositoryCheckoutSession,
} from '$shared/types/repository-checkout';
import { BackendError } from './backend-transport-types';

const localId = z.string().min(1).max(128);
const retired = () => ({ status: 'unavailable' as const, reason: 'retired' as const });

/** Capture the preload bridge once; every consuming call keeps that exact bridge. */
export function createRepositoryCheckoutTransport(
  getBridge: () => Window['electronAPI'] | undefined,
) {
  const channels = IPC_CHANNELS.BACKEND.REPOSITORY_CHECKOUT;
  const unavailable = () =>
    new BackendError({
      code: 'REPOSITORY_CHECKOUT_UNAVAILABLE',
      message: 'REPOSITORY_CHECKOUT_UNAVAILABLE',
    });
  const unwrap = (raw: unknown) => {
    const response = z
      .object({ ok: z.literal(true), result: z.unknown() })
      .strict()
      .safeParse(raw);
    if (!response.success) throw unavailable();
    return response.data.result;
  };
  return async (
    input: CheckoutCaptureQuery,
  ): Promise<CheckoutResult<RepositoryCheckoutSession>> => {
    const query = CheckoutCaptureQuerySchema.parse(input);
    const bridge = getBridge();
    if (!bridge) throw unavailable();
    let id: string | undefined,
      dead = false,
      released = false;
    const early = new Set<string>(),
      listeners = new Set<() => void>();
    const retire = () => {
      if (dead) return;
      dead = true;
      for (const listener of [...listeners]) {
        try {
          listener();
        } catch {
          /* Notify every owner. */
        }
      }
      listeners.clear();
    };
    const listenerId = bridge.on(channels.RETIRED, (raw: unknown) => {
      const notice = z.object({ id: localId }).strict().safeParse(raw);
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
      if (id !== undefined) {
        try {
          await bridge.invoke(channels.RELEASE, { id });
        } catch {
          /* Original main lifetime and daemon expiry own cleanup. */
        }
      }
    };
    const current = () => {
      if (getBridge() !== bridge) retire();
      return !dead && !released;
    };
    try {
      const raw = unwrap(await bridge.invoke(channels.CAPTURE, query));
      const reference = z.object({ value: z.object({ id: localId }) }).safeParse(raw);
      if (reference.success) id = reference.data.value.id;
      const result = checkoutResultSchema(
        z.object({ id: localId, capture: CheckoutCaptureSchema }).strict(),
      ).parse(raw);
      if (result.status === 'unavailable') {
        await release();
        return result;
      }
      id = result.value.id;
      if (early.has(id)) retire();
      early.clear();
      if (!current()) throw unavailable();
      const capture = Object.freeze(result.value.capture);
      const request = async <T extends z.ZodTypeAny>(
        kind: string,
        params: object,
        schema: T,
      ): Promise<CheckoutResult<z.infer<T>>> => {
        if (!current()) return retired();
        try {
          const result = parseCheckoutResult(
            schema,
            unwrap(await bridge.invoke(channels.REQUEST, { id, kind, params })),
          );
          return current() ? result : retired();
        } catch (error) {
          await release();
          throw error;
        }
      };
      return {
        status: 'ready',
        value: {
          capture,
          onRetired(listener) {
            if (!current()) {
              listener();
              return () => {};
            }
            listeners.add(listener);
            return () => {
              listeners.delete(listener);
            };
          },
          projects: (params) =>
            request('projects', CheckoutPageQuerySchema.parse(params), CheckoutProjectsSchema),
          project: (params) =>
            request(
              'project',
              CheckoutProjectQuerySchema.parse(params),
              CheckoutProjectDetailSchema,
            ),
          branches: (params) =>
            request('branches', CheckoutBranchesQuerySchema.parse(params), CheckoutBranchesSchema),
          async warm(input) {
            const selected = CheckoutSelectionSchema.parse(input);
            if (
              selected.checkoutId !== capture.checkoutId ||
              selected.revision !== capture.revision
            )
              return retired();
            const result = await request('warm', selected, CheckoutWarmSchema);
            if (
              result.status === 'ready' &&
              (result.value.projectPath !== selected.projectPath ||
                result.value.branch !== selected.branch ||
                result.value.commitSha !== selected.commitSha)
            ) {
              await release();
              throw unavailable();
            }
            return result;
          },
          release,
        },
      };
    } catch (error) {
      await release();
      throw error;
    }
  };
}
