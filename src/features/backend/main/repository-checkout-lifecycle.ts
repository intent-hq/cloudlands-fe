import { randomUUID } from 'node:crypto';
import type { IpcMain, IpcMainInvokeEvent, WebContents } from 'electron';
import { z } from 'zod';
import { IPC_CHANNELS } from '$shared/ipc-registry';
import {
  CheckoutCaptureQuerySchema,
  CheckoutPageQuerySchema,
  CheckoutProjectQuerySchema,
  CheckoutBranchesQuerySchema,
  CheckoutSelectionSchema,
  type CheckoutCaptureQuery,
  type CheckoutResult,
} from '$shared/types/repository-checkout';
import {
  getStrictBackendBindingForWebContents,
  onStrictBackendBindingRetired,
} from '../../../main/window-backend';
import type { JsonRpcClient } from './json-rpc-client';
import type { RepositoryCheckoutLifetime } from './repository-checkout-feed';

const localId = z.string().min(1).max(128);
const bound = z.object({ id: localId }).strict();
const requestSchema = z.discriminatedUnion('kind', [
  bound.extend({ kind: z.literal('projects'), params: CheckoutPageQuerySchema }).strict(),
  bound.extend({ kind: z.literal('project'), params: CheckoutProjectQuerySchema }).strict(),
  bound.extend({ kind: z.literal('branches'), params: CheckoutBranchesQuerySchema }).strict(),
  bound.extend({ kind: z.literal('warm'), params: CheckoutSelectionSchema }).strict(),
]);
const unavailable = () => ({
  ok: false as const,
  error: {
    code: 'REPOSITORY_CHECKOUT_UNAVAILABLE',
    message: 'REPOSITORY_CHECKOUT_UNAVAILABLE',
    rpcCode: -32003,
  },
});
const invalid = () => ({
  ok: false as const,
  error: { code: 'INVALID_PARAMS', message: 'INVALID_PARAMS', rpcCode: -32602 },
});

interface Dependencies {
  readBackend(id: string): JsonRpcClient | undefined;
  capture(
    client: JsonRpcClient,
    connection: object,
    query: CheckoutCaptureQuery,
  ): Promise<CheckoutResult<RepositoryCheckoutLifetime>>;
  errorPayload(error: unknown): { code: string; message: string; data?: unknown; rpcCode?: number };
}

/** The document, target host, pool entry and original socket are captured before any await. */
export function registerRepositoryCheckoutHandlers(
  ipc: Pick<IpcMain, 'handle'>,
  deps: Dependencies,
) {
  const channels = IPC_CHANNELS.BACKEND.REPOSITORY_CHECKOUT;
  type Binding = NonNullable<ReturnType<typeof getStrictBackendBindingForWebContents>>;
  type Owner = {
    sender: WebContents;
    binding: Binding;
    client: JsonRpcClient;
    connection: object;
    retired: boolean;
  };
  type Entry = Owner & { lifetime: RepositoryCheckoutLifetime; stop?: () => void };
  const entries = new Map<string, Entry>();
  const pending = new Set<Owner>();
  const observed = new Map<WebContents, () => void>();
  let disposed = false;
  const current = (owner: Owner) =>
    !disposed &&
    !owner.retired &&
    getStrictBackendBindingForWebContents(owner.sender) === owner.binding &&
    deps.readBackend(owner.binding.backendId) === owner.client &&
    owner.client.getRepositoryConnection() === owner.connection;

  function drop(id: string, entry: Entry) {
    if (entries.get(id) !== entry) return;
    entries.delete(id);
    entry.retired = true;
    entry.stop?.();
    entry.lifetime.dispose();
    if (entry.sender.mainFrame === entry.binding.frame && !entry.sender.isDestroyed()) {
      try {
        entry.binding.frame.send(channels.RETIRED, { id });
      } catch {
        /* Original document gone. */
      }
    }
  }
  function retireSender(sender: WebContents) {
    for (const owner of pending) if (owner.sender === sender) owner.retired = true;
    for (const [id, entry] of entries) if (entry.sender === sender) drop(id, entry);
  }
  function observe(sender: WebContents) {
    if (observed.has(sender)) return;
    const retire = () => retireSender(sender);
    const stopBinding = onStrictBackendBindingRetired(sender, retire);
    const navigation = (_event: unknown, _url: string, inPlace: boolean, mainFrame: boolean) => {
      if (mainFrame && !inPlace) retire();
    };
    const cleanup = () => {
      retire();
      stopBinding();
      sender.removeListener('did-start-navigation', navigation);
      sender.removeListener('render-process-gone', retire);
      sender.removeListener('destroyed', cleanup);
      observed.delete(sender);
    };
    sender.on('did-start-navigation', navigation);
    sender.on('render-process-gone', retire);
    sender.once('destroyed', cleanup);
    observed.set(sender, cleanup);
  }
  function owned(event: IpcMainInvokeEvent, id: string): Entry | undefined {
    const entry = entries.get(id);
    if (!entry || entry.sender !== event.sender || entry.binding.frame !== event.senderFrame)
      return;
    if (!current(entry) || !entry.lifetime.isCurrent()) {
      drop(id, entry);
      return;
    }
    return entry;
  }

  ipc.handle(channels.CAPTURE, async (event, payload: unknown) => {
    const parsed = CheckoutCaptureQuerySchema.safeParse(payload);
    if (!parsed.success) return invalid();
    const sender = event.sender;
    const binding = getStrictBackendBindingForWebContents(sender);
    if (disposed || !binding || binding.frame !== event.senderFrame) return unavailable();
    const client = deps.readBackend(binding.backendId);
    const connection = client?.getRepositoryConnection();
    if (!client || !connection?.gitlabCheckout || entries.size + pending.size >= 64)
      return unavailable();
    const owner: Owner = { sender, binding, client, connection, retired: false };
    pending.add(owner);
    observe(sender);
    let published = false;
    try {
      const result = await deps.capture(client, connection, parsed.data);
      if (result.status === 'unavailable')
        return current(owner) ? { ok: true as const, result } : unavailable();
      const lifetime = result.value;
      if (!current(owner) || !lifetime.isCurrent()) {
        lifetime.dispose();
        return unavailable();
      }
      const id = randomUUID();
      const entry: Entry = { ...owner, lifetime };
      entries.set(id, entry);
      entry.stop = lifetime.onRetired(() => drop(id, entry));
      if (!current(entry) || entries.get(id) !== entry || !lifetime.isCurrent()) {
        drop(id, entry);
        return unavailable();
      }
      published = true;
      return {
        ok: true as const,
        result: { status: 'ready' as const, value: { id, capture: lifetime.capture } },
      };
    } catch {
      return unavailable();
    } finally {
      if (!published) owner.retired = true;
      pending.delete(owner);
    }
  });

  ipc.handle(channels.REQUEST, async (event, payload: unknown) => {
    const parsed = requestSchema.safeParse(payload);
    if (!parsed.success) return invalid();
    const input = parsed.data;
    const entry = owned(event, input.id);
    if (!entry) return unavailable();
    try {
      let result: unknown;
      switch (input.kind) {
        case 'projects':
          result = await entry.lifetime.projects(input.params);
          break;
        case 'project':
          result = await entry.lifetime.project(input.params);
          break;
        case 'branches':
          result = await entry.lifetime.branches(input.params);
          break;
        case 'warm':
          result = await entry.lifetime.warm(input.params);
          break;
      }
      if (!current(entry) || entry.lifetime.isCurrent() === false) {
        return unavailable();
      }
      return { ok: true as const, result };
    } catch {
      drop(input.id, entry);
      return unavailable();
    }
  });

  ipc.handle(channels.RELEASE, (event, payload: unknown) => {
    const parsed = bound.safeParse(payload);
    if (!parsed.success) return invalid();
    const entry = owned(event, parsed.data.id);
    if (entry) drop(parsed.data.id, entry);
    return { ok: true as const, result: { released: true } };
  });

  return {
    async create(event: IpcMainInvokeEvent, params: unknown, timeoutMs?: number) {
      const parsed = z
        .object({
          repositoryCheckout: CheckoutSelectionSchema,
          branch: z.string().min(1).optional(),
        })
        .passthrough()
        .safeParse(params);
      if (!parsed.success) return invalid();
      for (const key of [
        'repositoryPath',
        'githubUrl',
        'clonePath',
        'repositoryOwner',
        'repositoryName',
        'worktreePath',
        'baseRef',
        'baseCommitSha',
        'remote',
        'path',
        'environmentConfig',
      ]) {
        if (
          Object.prototype.hasOwnProperty.call(parsed.data, key) &&
          parsed.data[key] !== undefined
        )
          return invalid();
      }
      for (const key of ['isRemote', 'isNewRepo', 'skipIsolation', 'skipWorktree']) {
        if (parsed.data[key] !== undefined && parsed.data[key] !== false) return invalid();
      }
      const selection = parsed.data.repositoryCheckout;
      for (const [id, candidate] of entries) {
        const capture = candidate.lifetime.capture;
        if (capture.checkoutId !== selection.checkoutId || capture.revision !== selection.revision)
          continue;
        const entry = owned(event, id);
        if (!entry) return unavailable();
        try {
          const result = await entry.lifetime.create(parsed.data, timeoutMs);
          if (owned(event, id) !== entry) return unavailable();
          return { ok: true as const, result };
        } catch (error) {
          if (owned(event, id) !== entry) return unavailable();
          // A current operation failure is not an ownership change. Retiring here
          // would invalidate the renderer before it can display the original error.
          return { ok: false as const, error: deps.errorPayload(error) };
        }
      }
      return unavailable();
    },
    retireBackend(backendId: string) {
      for (const owner of pending) if (owner.binding.backendId === backendId) owner.retired = true;
      for (const [id, entry] of entries) if (entry.binding.backendId === backendId) drop(id, entry);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const owner of pending) owner.retired = true;
      for (const [id, entry] of entries) drop(id, entry);
      for (const cleanup of [...observed.values()]) cleanup();
    },
  };
}
