import { z } from 'zod';
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
  CheckoutBindingSchema,
  checkoutResultSchema,
  parseCheckoutResult,
  type CheckoutCaptureQuery,
  type CheckoutCapture,
  type CheckoutSelection,
  type CheckoutResult,
  type CheckoutPageQuery,
  type CheckoutProjectQuery,
  type CheckoutBranchesQuery,
} from '$shared/types/repository-checkout';
import type { JsonRpcClient, RepositoryConnection } from './json-rpc-client';

const PREFIX = 'sourceControl.checkout.';
const LIMIT = 64;
const retired = () => ({ status: 'unavailable' as const, reason: 'retired' as const });

/** All work, including cleanup and creation, uses the original physical socket. */
export function createRepositoryCheckoutFeed(client: JsonRpcClient) {
  type Owner = { connection: RepositoryConnection; retire(): void };
  const owners = new Set<Owner>();
  let disposed = false;
  const stop = client.onRepositoryConnectionEvent((event) => {
    for (const owner of [...owners]) {
      if (
        (event.type === 'identity-retired' && event.connection === owner.connection) ||
        (event.type === 'closed' && event.incarnation === owner.connection.incarnation)
      ) {
        owner.retire();
      }
    }
  });

  async function capture(connection: object, input: CheckoutCaptureQuery) {
    const original = client.getRepositoryConnection();
    if (
      disposed ||
      !original ||
      original !== connection ||
      !original.gitlabCheckout ||
      owners.size >= LIMIT
    )
      return retired();
    const query = CheckoutCaptureQuerySchema.parse(input);
    const producer = client.beginOriginalProducer();
    let dead = false,
      acquisitionDone = false,
      cleanupStarted = false,
      producerDone = false;
    let pending = 0;
    let binding: CheckoutCapture | undefined;
    let cleanupBinding: { checkoutId: string; revision: string } | undefined;
    let denied: Exclude<CheckoutResult<never>, { status: 'ready' }> | undefined;
    let expiry: ReturnType<typeof setTimeout> | undefined;
    const listeners = new Set<() => void>();
    const started = Date.now();
    const finish = () => {
      if (dead && acquisitionDone && pending === 0 && !producerDone) {
        producerDone = true;
        owners.delete(owner);
        client.finishOriginalProducer(producer);
      }
    };
    const request = async (method: string, params: unknown, timeoutMs = 30_000) => {
      pending++;
      try {
        return await client.requestOnCapturedConnection(
          original,
          method,
          params,
          { timeoutMs },
          producer,
        );
      } finally {
        pending--;
        finish();
      }
    };
    const cleanup = () => {
      if (!cleanupBinding || cleanupStarted) return;
      cleanupStarted = true;
      void request(
        PREFIX + 'release',
        {
          checkoutId: cleanupBinding.checkoutId,
          revision: cleanupBinding.revision,
        },
        5_000,
      ).catch(() => {
        // Original socket retirement or daemon expiry owns remaining cleanup.
      });
    };
    const owner: Owner = {
      connection: original,
      retire() {
        if (dead) return;
        dead = true;
        clearTimeout(expiry);
        cleanup();
        for (const listener of [...listeners]) {
          try {
            listener();
          } catch {
            /* Notify every original owner. */
          }
        }
        listeners.clear();
        finish();
      },
    };
    owners.add(owner);
    const current = () => {
      if (
        !dead &&
        (disposed ||
          client.getRepositoryConnection() !== original ||
          (binding && Date.now() >= started + binding.expiresAfterMs))
      )
        owner.retire();
      return !dead;
    };
    let captureTimer: ReturnType<typeof setTimeout> | undefined;
    const work = (async () => {
      try {
        const raw = await request(PREFIX + 'capture', query, 15_000);
        // A malformed result can still name an allocated lease. Release that
        // known lease on the original socket even when its other fields fail.
        const reference = z.object({ value: CheckoutBindingSchema.passthrough() }).safeParse(raw);
        if (reference.success) cleanupBinding = reference.data.value;
        const result = checkoutResultSchema(CheckoutCaptureSchema).parse(raw);
        if (result.status === 'unavailable') {
          owner.retire();
          return result;
        }
        binding = Object.freeze(result.value);
        if (
          query.instanceBaseUrl !== undefined &&
          query.instanceBaseUrl !== binding.instanceBaseUrl
        ) {
          owner.retire();
        }
        if (!current()) {
          cleanup();
          return retired();
        }
        expiry = setTimeout(
          () => owner.retire(),
          Math.max(0, started + binding.expiresAfterMs - Date.now()),
        );
        expiry.unref();
        const captured = binding;
        const perform = async <T extends z.ZodTypeAny>(
          method: string,
          params: object,
          schema: T,
        ): Promise<CheckoutResult<z.infer<T>>> => {
          if (!current()) return retired();
          if (denied) return denied;
          try {
            const result = parseCheckoutResult(
              schema,
              await request(PREFIX + method, {
                ...params,
                checkoutId: captured.checkoutId,
                revision: captured.revision,
              }),
            );
            if (!current()) return retired();
            if (
              result.status === 'unavailable' &&
              ['disabled', 'not-connected', 'access-denied', 'retired'].includes(result.reason)
            ) {
              // Deliver the precise refusal before the consumer retires its UI.
              // Concurrent private results and later calls cannot revive it.
              denied = result;
              cleanup();
            }
            return denied ?? result;
          } catch (error) {
            owner.retire();
            throw error;
          }
        };
        const selection = (value: CheckoutSelection) => {
          const selected = CheckoutSelectionSchema.parse(value);
          if (
            selected.checkoutId !== captured.checkoutId ||
            selected.revision !== captured.revision
          ) {
            throw new Error('REPOSITORY_CHECKOUT_BINDING_MISMATCH');
          }
          return selected;
        };
        const lifetime = {
          capture: captured,
          isCurrent: current,
          onRetired(listener: () => void) {
            if (!current()) {
              listener();
              return () => {};
            }
            listeners.add(listener);
            return () => {
              listeners.delete(listener);
            };
          },
          dispose: () => owner.retire(),
          projects: (params: CheckoutPageQuery) =>
            perform('projects', CheckoutPageQuerySchema.parse(params), CheckoutProjectsSchema),
          project: (params: CheckoutProjectQuery) =>
            perform(
              'project',
              CheckoutProjectQuerySchema.parse(params),
              CheckoutProjectDetailSchema,
            ),
          branches: (params: CheckoutBranchesQuery) =>
            perform('branches', CheckoutBranchesQuerySchema.parse(params), CheckoutBranchesSchema),
          async warm(value: CheckoutSelection) {
            const selected = selection(value);
            const result = await perform('warm', selected, CheckoutWarmSchema);
            if (
              result.status === 'ready' &&
              (result.value.projectPath !== selected.projectPath ||
                result.value.branch !== selected.branch ||
                result.value.commitSha !== selected.commitSha)
            ) {
              owner.retire();
              throw new Error('REPOSITORY_CHECKOUT_RESULT_MISMATCH');
            }
            return result;
          },
          async create(params: Record<string, unknown>, timeoutMs?: number) {
            selection(CheckoutSelectionSchema.parse(params.repositoryCheckout));
            if (!current() || denied) throw new Error('REPOSITORY_CHECKOUT_RETIRED');
            try {
              const result = await request('workspace.create', params, timeoutMs);
              if (!current() || denied) throw new Error('REPOSITORY_CHECKOUT_RETIRED');
              return result;
            } catch (error) {
              if (!current() || denied) {
                owner.retire();
                throw new Error('REPOSITORY_CHECKOUT_RETIRED');
              }
              throw error;
            }
          },
        };
        return { status: 'ready' as const, value: lifetime };
      } catch (error) {
        owner.retire();
        throw error;
      } finally {
        acquisitionDone = true;
        if (dead) cleanup();
        finish();
      }
    })();
    try {
      return await Promise.race([
        work,
        new Promise<ReturnType<typeof retired>>((resolve) => {
          captureTimer = setTimeout(() => {
            owner.retire();
            resolve(retired());
          }, 5_000);
          captureTimer.unref();
        }),
      ]);
    } finally {
      clearTimeout(captureTimer);
    }
  }

  return {
    capture,
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const owner of [...owners]) owner.retire();
      stop();
    },
  };
}

export type RepositoryCheckoutLifetime = Extract<
  Awaited<ReturnType<ReturnType<typeof createRepositoryCheckoutFeed>['capture']>>,
  { status: 'ready' }
>['value'];
