import { randomUUID } from 'node:crypto';
import type { IpcMain, IpcMainInvokeEvent, WebContents } from 'electron';
import { z } from 'zod';
import { IPC_CHANNELS } from '$shared/ipc-registry';
import {
  RepositoryResourceRequestSchema,
  RepositoryResourceWorkspaceSchema,
} from '$shared/types/repository-resource-read';
import {
  getStrictBackendBindingForWebContents,
  onStrictBackendBindingRetired,
} from '../../../main/window-backend';
import type { JsonRpcClient } from './json-rpc-client';
import type { createRepositoryResourceFeed } from './repository-resource-feed';

type Lifetime = Awaited<ReturnType<ReturnType<typeof createRepositoryResourceFeed>['capture']>>;
interface Dependencies {
  readBackend(id: string): JsonRpcClient | undefined;
  capture(client: JsonRpcClient, connection: object, workspaceId: string): Promise<Lifetime>;
}
const bound = RepositoryResourceWorkspaceSchema.extend({ id: z.string().min(1).max(128) }).strict();
const detail = bound.extend(RepositoryResourceRequestSchema.shape).strict();
const unavailable = () => ({
  ok: false as const,
  error: {
    code: 'REPOSITORY_RESOURCE_UNAVAILABLE',
    message: 'REPOSITORY_RESOURCE_UNAVAILABLE',
  },
});
const invalid = () => ({
  ok: false as const,
  error: { code: 'INVALID_PARAMS', message: 'INVALID_PARAMS' },
});

/** Private ownership is established before acquisition, never from renderer IDs. */
export function registerRepositoryResourceHandlers(
  ipc: Pick<IpcMain, 'handle'>,
  deps: Dependencies,
) {
  const channels = IPC_CHANNELS.BACKEND.REPOSITORY_RESOURCE;
  type Binding = NonNullable<ReturnType<typeof getStrictBackendBindingForWebContents>>;
  type Owner = {
    sender: WebContents;
    binding: Binding;
    client: JsonRpcClient;
    connection: object;
    workspaceId: string;
    retired: boolean;
  };
  type Entry = Owner & { lifetime: Lifetime; stop?: () => void };
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
    // Send only to the original document, never to its successor.
    if (entry.sender.mainFrame === entry.binding.frame && !entry.sender.isDestroyed()) {
      try {
        entry.binding.frame.send(channels.RETIRED, { id });
      } catch {
        /* Document gone. */
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

  ipc.handle(channels.CAPTURE, async (event, payload: unknown) => {
    const parsed = RepositoryResourceWorkspaceSchema.safeParse(payload);
    if (!parsed.success) return invalid();
    const sender = event.sender;
    const binding = getStrictBackendBindingForWebContents(sender);
    if (disposed || !binding || binding.frame !== event.senderFrame) return unavailable();
    const client = deps.readBackend(binding.backendId);
    const connection = client?.getRepositoryConnection();
    if (!client || !connection?.repositoryResourceRead || entries.size + pending.size >= 64)
      return unavailable();
    const owner: Owner = {
      sender,
      binding,
      client,
      connection,
      workspaceId: parsed.data.workspaceId,
      retired: false,
    };
    pending.add(owner);
    observe(sender);
    let timer: ReturnType<typeof setTimeout> | undefined;
    let published = false;
    try {
      const acquisition = deps.capture(client, connection, owner.workspaceId);
      void acquisition.then(
        (lifetime) => {
          if (!current(owner)) lifetime.dispose();
        },
        () => {},
      );
      const lifetime = await Promise.race([
        acquisition,
        new Promise<null>((resolve) => {
          timer = setTimeout(() => {
            owner.retired = true;
            resolve(null);
          }, 5_000);
          timer.unref();
        }),
      ]);
      if (!lifetime || !current(owner) || !lifetime.isCurrent()) {
        lifetime?.dispose();
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
      return { ok: true as const, result: { id, capture: lifetime.capture } };
    } catch {
      // Neither transport/provider prose nor private admission facts enter IPC.
      return unavailable();
    } finally {
      if (!published) owner.retired = true;
      clearTimeout(timer);
      pending.delete(owner);
    }
  });

  function owned(event: IpcMainInvokeEvent, id: string, workspaceId: string): Entry | null {
    const entry = entries.get(id);
    if (
      !entry ||
      entry.sender !== event.sender ||
      entry.binding.frame !== event.senderFrame ||
      entry.workspaceId !== workspaceId
    )
      return null;
    if (!current(entry) || !entry.lifetime.isCurrent()) {
      drop(id, entry);
      return null;
    }
    return entry;
  }
  ipc.handle(channels.DETAIL, async (event, payload: unknown) => {
    const parsed = detail.safeParse(payload);
    if (!parsed.success) return invalid();
    const { id, workspaceId, target, refresh } = parsed.data;
    const entry = owned(event, id, workspaceId);
    if (!entry) return unavailable();
    try {
      const result = await entry.lifetime.detail(target, refresh);
      if (owned(event, id, workspaceId) !== entry) return unavailable();
      return { ok: true as const, result };
    } catch {
      drop(id, entry);
      return unavailable();
    }
  });
  ipc.handle(channels.RELEASE, (event, payload: unknown) => {
    const parsed = bound.safeParse(payload);
    if (!parsed.success) return invalid();
    const entry = owned(event, parsed.data.id, parsed.data.workspaceId);
    if (entry) drop(parsed.data.id, entry);
    // Idempotent cleanup never reveals another sender's lifetime.
    return { ok: true as const, result: { released: true } };
  });
  return {
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
