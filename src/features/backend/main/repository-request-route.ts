/**
 * Inactive main-process routing boundary. None of these handles are wire DTOs.
 * Trusted producers must supply strict window stamps (never the legacy local
 * fallback), pool identity, a fresh stamp for every physical connection, and a
 * repository lifetime retired by account/authority/context changes. Stamps must
 * never be reused, including after an A -> B -> A transition between reads.
 * This preserves routing; daemon admission and the existing UI guard still apply.
 */
import {
  RepositoryRootIdentitySchema,
  type RepositoryRootIdentity,
} from '$shared/types/repository-context';

declare const bindingBrand: unique symbol;
declare const completionBrand: unique symbol;

export type RepositoryRequestBinding = Readonly<{ [bindingBrand]: true }>;
export type RepositoryOperationCompletion<T> = Readonly<{ [completionBrand]: T }>;
export type RepositoryOperationSettlement<T> =
  Readonly<{ status: 'fulfilled'; value: T }> | Readonly<{ status: 'rejected'; reason: unknown }>;

export interface RepositoryRequestRouteSources<Sender extends object, Client extends object> {
  /** Main-owned explicit stamp for this actual IPC sender, not a focused window. */
  readSenderBinding(sender: Sender): {
    window: object;
    stamp: object;
    backendId: string;
  } | null;
  /** connected is true only for a usable connection; reconnect rotates incarnation. */
  readBackend(backendId: string): {
    client: Client;
    incarnation: object;
    connected: boolean;
  } | null;
  /**
   * Trusted retirement identity for this root and its original account/authority
   * and context. Not a serialized permission or a replacement authority selector.
   * Null means unavailable. Changing it permanently retires existing captures.
   */
  readRepositoryLifetime(sender: Sender, root: Readonly<RepositoryRootIdentity>): object | null;
}

const isObject = (value: unknown): value is object => typeof value === 'object' && value !== null;

export function createRepositoryRequestRoutes<Sender extends object, Client extends object>(
  sources: RepositoryRequestRouteSources<Sender, Client>,
) {
  type Route = {
    sender: Sender;
    window: object;
    windowStamp: object;
    backendId: string;
    client: Client;
    incarnation: object;
    lifetime: object;
    root: Readonly<RepositoryRootIdentity>;
    retired: boolean;
    receiptsRetired: boolean;
  };
  type Completion = {
    route: Route;
    settlement: RepositoryOperationSettlement<unknown>;
    applied: boolean;
  };

  const routes = new WeakMap<object, Route>();
  const completions = new WeakMap<object, Completion>();
  const unavailable = () => new Error('Repository request route is unavailable');

  function ownedRoute(sender: Sender, binding: unknown): Route | undefined {
    const route = isObject(binding) ? routes.get(binding) : undefined;
    return route?.sender === sender ? route : undefined;
  }

  // Old facts may be inspected after a connection drops, but never by a new
  // window/backend/account/authority/root lifetime. Wrong senders cannot retire
  // someone else's handle by probing it.
  function ownsReceiptScope(route: Route): boolean {
    if (route.receiptsRetired) return false;
    try {
      const binding = sources.readSenderBinding(route.sender);
      if (
        binding?.window === route.window &&
        binding.stamp === route.windowStamp &&
        binding.backendId === route.backendId &&
        sources.readRepositoryLifetime(route.sender, route.root) === route.lifetime
      ) {
        return true;
      }
    } catch {
      // An unreadable lifetime cannot establish eligibility.
    }
    route.retired = true;
    route.receiptsRetired = true;
    return false;
  }

  function isCapturedRepositoryRequestCurrent(sender: Sender, binding: unknown): boolean {
    const route = ownedRoute(sender, binding);
    if (!route || !ownsReceiptScope(route) || route.retired) return false;
    try {
      const backend = sources.readBackend(route.backendId);
      if (
        backend?.connected === true &&
        backend.client === route.client &&
        backend.incarnation === route.incarnation
      ) {
        return true;
      }
    } catch {
      // No fallback or reacquisition after a failed pool read.
    }
    route.retired = true;
    return false;
  }

  function captureRepositoryRequestBinding(
    sender: Sender,
    root: RepositoryRootIdentity,
  ): RepositoryRequestBinding {
    const capturedRoot = Object.freeze(RepositoryRootIdentitySchema.parse(root));
    try {
      const binding = sources.readSenderBinding(sender);
      if (
        !binding ||
        !isObject(binding.window) ||
        !isObject(binding.stamp) ||
        typeof binding.backendId !== 'string' ||
        !binding.backendId
      ) {
        throw unavailable();
      }
      const backend = sources.readBackend(binding.backendId);
      const lifetime = sources.readRepositoryLifetime(sender, capturedRoot);
      if (
        backend?.connected !== true ||
        !isObject(backend.client) ||
        !isObject(backend.incarnation) ||
        !isObject(lifetime)
      ) {
        throw unavailable();
      }
      const handle = Object.freeze(Object.create(null)) as RepositoryRequestBinding;
      routes.set(handle, {
        sender,
        window: binding.window,
        windowStamp: binding.stamp,
        backendId: binding.backendId,
        client: backend.client,
        incarnation: backend.incarnation,
        lifetime,
        root: capturedRoot,
        retired: false,
        receiptsRetired: false,
      });
      return handle;
    } catch {
      throw unavailable();
    }
  }

  function retainRepositoryOperationReceipt<T>(
    route: Route,
    settlement: RepositoryOperationSettlement<T>,
  ): RepositoryOperationCompletion<T> {
    const completion = Object.freeze(Object.create(null)) as RepositoryOperationCompletion<T>;
    // Retain before any current-context check. Rejection is an observation, not
    // proof that no effects occurred. Do not normalize native results or errors.
    completions.set(completion, { route, settlement: Object.freeze(settlement), applied: false });
    return completion;
  }

  async function backendRequestForCapturedBinding<T>(
    sender: Sender,
    binding: RepositoryRequestBinding,
    dispatch: (client: Client, root: Readonly<RepositoryRootIdentity>) => Promise<T>,
  ): Promise<RepositoryOperationCompletion<T>> {
    const route = ownedRoute(sender, binding);
    if (!route || !isCapturedRepositoryRequestCurrent(sender, binding)) throw unavailable();
    // Invoke synchronously after the fence, before yielding. A queued caller
    // holds the original binding and invokes this only when ready to dispatch;
    // dispatch itself must send now, not introduce another unfenced queue.
    let settlement: RepositoryOperationSettlement<T>;
    try {
      settlement = { status: 'fulfilled', value: await dispatch(route.client, route.root) };
    } catch (reason) {
      settlement = { status: 'rejected', reason };
    }
    return retainRepositoryOperationReceipt(route, settlement);
  }

  function ownedCompletion(
    sender: Sender,
    binding: unknown,
    completion: unknown,
  ): Completion | undefined {
    const route = ownedRoute(sender, binding);
    const result = isObject(completion) ? completions.get(completion) : undefined;
    return route && result?.route === route ? result : undefined;
  }

  /** Main-private reconciliation only; this is not an IPC receipt-read endpoint. */
  function readRetainedRepositoryOperation<T>(
    sender: Sender,
    binding: RepositoryRequestBinding,
    completion: RepositoryOperationCompletion<T>,
  ): RepositoryOperationSettlement<T> | null {
    const result = ownedCompletion(sender, binding, completion);
    return result && ownsReceiptScope(result.route)
      ? (result.settlement as RepositoryOperationSettlement<T>)
      : null;
  }

  /** Run a synchronous current-context update at most once for this completion. */
  function applyRepositoryOperationCompletion<T>(
    sender: Sender,
    binding: RepositoryRequestBinding,
    completion: RepositoryOperationCompletion<T>,
    apply: (settlement: RepositoryOperationSettlement<T>) => void,
  ): boolean {
    const result = ownedCompletion(sender, binding, completion);
    if (result?.applied !== false || !isCapturedRepositoryRequestCurrent(sender, binding)) {
      return false;
    }
    result.applied = true;
    apply(result.settlement as RepositoryOperationSettlement<T>);
    return true;
  }

  function retireRepositoryRequestBinding(sender: Sender, binding: unknown): boolean {
    const route = ownedRoute(sender, binding);
    if (!route) return false;
    route.retired = true;
    return true;
  }

  return {
    captureRepositoryRequestBinding,
    isCapturedRepositoryRequestCurrent,
    backendRequestForCapturedBinding,
    readRetainedRepositoryOperation,
    applyRepositoryOperationCompletion,
    retireRepositoryRequestBinding,
  };
}
