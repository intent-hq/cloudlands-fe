import { randomUUID } from 'node:crypto';
import type { IpcMain, IpcMainInvokeEvent, WebContents } from 'electron';
import { z } from 'zod';
import { getStrictBackendBindingForWebContents } from '../../../main/window-backend';
import { IPC_CHANNELS } from '$shared/ipc-registry';
import { repositoryRootKey } from '$shared/types/repository-context';
import {
  NativeReviewInputSchema,
  NativeReviewTextCommandSchema,
  NativeReviewRootSchema,
  type NativeReviewObservation,
} from '$shared/types/native-review-operation';
import { createRepositoryRequestRoutes } from './repository-request-route';
import type { JsonRpcClient } from './json-rpc-client';
import type { NativeReviewLifetime } from './native-review-feed';

const captureSchema = z.union([
  z.object({ input: NativeReviewInputSchema }).strict(),
  z.object({ companionOf: z.string().min(1).max(4096), root: NativeReviewRootSchema }).strict(),
]);
const ownedSchema = z
  .object({ root: NativeReviewRootSchema, id: z.string().min(1).max(4096) })
  .strict();
const confirmSchema = ownedSchema.extend({ command: NativeReviewTextCommandSchema }).strict();
const failure = (code = 'NATIVE_REVIEW_UNAVAILABLE') => ({
  ok: false as const,
  error: { code, message: code },
});
interface Dependencies {
  readBackend(id: string): JsonRpcClient | undefined;
  prepare(
    client: JsonRpcClient,
    connection: object,
    input: z.infer<typeof NativeReviewInputSchema>,
  ): Promise<NativeReviewLifetime>;
}

/** The local ID only looks up an original sender-owned operation; it is not authority. */
export function registerNativeReviewHandlers(ipc: Pick<IpcMain, 'handle'>, deps: Dependencies) {
  type Routes = ReturnType<typeof createRepositoryRequestRoutes<WebContents, JsonRpcClient>>;
  type CaptureResult =
    | ReturnType<typeof failure>
    | {
        ok: true;
        result: { id: string; preview: NativeReviewLifetime['preview'] };
      };
  type Entry = {
    sender: WebContents;
    senderBinding: NonNullable<ReturnType<typeof getStrictBackendBindingForWebContents>>;
    client: JsonRpcClient;
    connection: object;
    companion?: Promise<CaptureResult>;
    root: z.infer<typeof NativeReviewRootSchema>;
    lifetime: NativeReviewLifetime;
    routes: Routes;
    binding: ReturnType<Routes['captureRepositoryRequestBinding']>;
    stop?: () => void;
    inFlight: boolean;
    completions: Array<Awaited<ReturnType<Routes['backendRequestForCapturedBinding']>>>;
  };
  const entries = new Map<string, Entry>();
  const acquiring = new Map<WebContents, Set<() => void>>();
  const listeners = new Map<WebContents, () => void>();
  let disposed = false;
  const channel = IPC_CHANNELS.BACKEND.NATIVE_REVIEW;
  function sameOwner(entry: Entry) {
    return (
      getStrictBackendBindingForWebContents(entry.sender) === entry.senderBinding &&
      entry.sender.mainFrame === entry.senderBinding.frame
    );
  }
  function drop(id: string, entry: Entry) {
    if (entries.get(id) !== entry) return;
    entries.delete(id);
    entry.stop?.();
    entry.routes.retireRepositoryRequestBinding(entry.sender, entry.binding);
    void entry.lifetime.release();
  }
  function retireSender(sender: WebContents) {
    for (const cancel of acquiring.get(sender) ?? []) cancel();
    for (const [id, entry] of entries) if (entry.sender === sender) drop(id, entry);
  }
  function observe(sender: WebContents) {
    if (listeners.has(sender)) return;
    const gone = () => retireSender(sender);
    const navigation = (_event: unknown, _url: string, inPlace: boolean, mainFrame: boolean) => {
      if (mainFrame && !inPlace) gone();
    };
    const cleanup = () => {
      gone();
      sender.removeListener('did-start-navigation', navigation);
      sender.removeListener('render-process-gone', gone);
      sender.removeListener('destroyed', cleanup);
      listeners.delete(sender);
    };
    sender.on('did-start-navigation', navigation);
    sender.on('render-process-gone', gone);
    sender.once('destroyed', cleanup);
    listeners.set(sender, cleanup);
  }
  const timer = setInterval(() => {
    for (const [id, entry] of entries)
      if (!sameOwner(entry) || !entry.lifetime.isLive()) drop(id, entry);
  }, 5_000);
  timer.unref();
  async function capture(
    event: IpcMainInvokeEvent,
    requestedRoot: z.infer<typeof NativeReviewRootSchema>,
    prepare: (client: JsonRpcClient, connection: object) => Promise<NativeReviewLifetime>,
    parent?: { id: string; entry: Entry },
  ): Promise<CaptureResult> {
    const sender = event.sender,
      binding = parent?.entry.senderBinding ?? getStrictBackendBindingForWebContents(sender);
    const client = parent?.entry.client ?? (binding && deps.readBackend(binding.backendId)),
      connection = parent?.entry.connection ?? client?.getRepositoryConnection();
    if (disposed || !binding || binding.frame !== event.senderFrame || !client || !connection)
      return failure();
    const pending = [...acquiring.values()].reduce((count, set) => count + set.size, 0);
    const mine =
      [...entries.values()].filter((entry) => entry.sender === sender).length +
      (acquiring.get(sender)?.size ?? 0);
    if (pending + entries.size >= 256 || mine >= 32) return failure();
    let abandoned = false,
      accepted = false;
    const cancel = () => {
      abandoned = true;
    };
    const own = acquiring.get(sender) ?? new Set<() => void>();
    own.add(cancel);
    acquiring.set(sender, own);
    observe(sender);
    const current = () =>
      !abandoned &&
      !disposed &&
      getStrictBackendBindingForWebContents(sender) === binding &&
      event.senderFrame === binding.frame &&
      deps.readBackend(binding.backendId) === client &&
      client.getRepositoryConnection() === connection &&
      (!parent || (entries.get(parent.id) === parent.entry && parent.entry.lifetime.isLive()));
    if (!current()) {
      own.delete(cancel);
      if (!own.size) acquiring.delete(sender);
      return failure();
    }
    let lifetime: NativeReviewLifetime | undefined;
    try {
      lifetime = await prepare(client, connection);
      if (!current() || !lifetime.isAdmitted()) return failure();
      const original = lifetime;
      const routes = createRepositoryRequestRoutes<WebContents, JsonRpcClient>({
        readSenderBinding: getStrictBackendBindingForWebContents,
        readBackend: (id) => {
          const backend = deps.readBackend(id),
            session = backend?.getRepositoryConnection();
          return backend && session
            ? { client: backend, incarnation: session, connected: true }
            : null;
        },
        readRepositoryLifetime: (owner, root) =>
          owner === sender &&
          repositoryRootKey(root) === repositoryRootKey(requestedRoot) &&
          original.isLive()
            ? original.stamp
            : null,
      });
      const root = Object.freeze({ ...requestedRoot }),
        route = routes.captureRepositoryRequestBinding(sender, root),
        id = randomUUID();
      const entry: Entry = {
        sender,
        senderBinding: binding,
        client,
        connection,
        root,
        lifetime,
        routes,
        binding: route,
        inFlight: false,
        completions: [],
      };
      entries.set(id, entry);
      entry.stop = lifetime.onRetired((kind) => {
        if (sameOwner(entry)) {
          try {
            entry.sender.mainFrame.send(channel.RETIRED, { id, kind });
          } catch {
            /* Original document gone. */
          }
        }
        if (kind === 'closed') drop(id, entry);
      });
      if (!current() || !lifetime.isAdmitted() || entries.get(id) !== entry) {
        drop(id, entry);
        return failure();
      }
      accepted = true;
      return { ok: true as const, result: { id, preview: lifetime.preview } };
    } catch {
      return failure();
    } finally {
      own.delete(cancel);
      if (!own.size) acquiring.delete(sender);
      if (!accepted) {
        abandoned = true;
        void lifetime?.release();
      }
    }
  }
  ipc.handle(channel.PREPARE, (event, payload: unknown) => {
    const parsed = captureSchema.safeParse(payload);
    if (!parsed.success) return failure('INVALID_PARAMS');
    const value = parsed.data;
    if ('input' in value)
      return capture(event, value.input.review.root, (client, connection) =>
        deps.prepare(client, connection, value.input),
      );
    const parent = find(event, { id: value.companionOf, root: value.root });
    if (!parent) return failure();
    if (parent.companion) return retainedCompanion(event, parent);
    const prepare = parent.lifetime.prepareCompanion;
    if (parent.inFlight || !prepare || !parent.lifetime.isLive()) {
      parent.companion = Promise.resolve(failure());
      return parent.companion;
    }
    parent.inFlight = true;
    parent.companion = Promise.resolve()
      .then(() =>
        capture(event, parent.root, () => prepare(), { id: value.companionOf, entry: parent }),
      )
      .finally(() => {
        parent.inFlight = false;
      });
    return retainedCompanion(event, parent);
  });
  function retainedCompanion(event: IpcMainInvokeEvent, parent: Entry): Promise<CaptureResult> {
    return parent.companion!.then((result) => {
      if (!result.ok) return result;
      const child = find(event, { id: result.result.id, root: parent.root });
      return child?.lifetime.isAdmitted() && parent.lifetime.isLive() ? result : failure();
    });
  }
  function find(event: IpcMainInvokeEvent, value: z.infer<typeof ownedSchema>) {
    const entry = entries.get(value.id);
    return entry &&
      entry.sender === event.sender &&
      entry.senderBinding.frame === event.senderFrame &&
      sameOwner(entry) &&
      repositoryRootKey(entry.root) === repositoryRootKey(value.root)
      ? entry
      : undefined;
  }
  async function execute(
    event: IpcMainInvokeEvent,
    entry: Entry,
    id: string,
    operation: () => Promise<NativeReviewObservation>,
  ) {
    if (entry.inFlight || entry.completions.length >= 65) return failure();
    entry.inFlight = true;
    try {
      const completed = await entry.routes.backendRequestForCapturedBinding(
        event.sender,
        entry.binding,
        operation,
      );
      entry.completions.push(completed); // Original settlement retained before UI/sender checks.
      if (
        entries.get(id) !== entry ||
        !sameOwner(entry) ||
        event.senderFrame !== entry.senderBinding.frame
      )
        return failure();
      const original = entry.routes.readRetainedRepositoryOperation(
        event.sender,
        entry.binding,
        completed,
      );
      if (!original || original.status === 'rejected') return failure();
      return {
        ok: true as const,
        result: {
          ...original.value,
          current: original.value.current && entry.lifetime.isAdmitted(),
        },
      };
    } catch {
      return failure();
    } finally {
      entry.inFlight = false;
    }
  }
  ipc.handle(channel.EXECUTE, async (event, payload: unknown) => {
    const parsed = confirmSchema.safeParse(payload);
    if (!parsed.success) return failure('INVALID_PARAMS');
    const entry = find(event, parsed.data);
    return entry
      ? execute(event, entry, parsed.data.id, () => entry.lifetime.confirm(parsed.data.command))
      : failure();
  });
  ipc.handle(channel.RECONCILE, async (event, payload: unknown) => {
    const parsed = ownedSchema.safeParse(payload);
    if (!parsed.success) return failure('INVALID_PARAMS');
    const entry = find(event, parsed.data);
    return entry
      ? execute(event, entry, parsed.data.id, () => entry.lifetime.reconcile())
      : failure();
  });
  ipc.handle(channel.RELEASE, async (event, payload: unknown) => {
    const parsed = ownedSchema.safeParse(payload);
    if (!parsed.success) return failure('INVALID_PARAMS');
    const entry = find(event, parsed.data);
    if (!entry) return failure();
    drop(parsed.data.id, entry);
    return { ok: true as const, result: { released: true } };
  });
  return {
    retireBackend(id: string) {
      for (const [key, entry] of entries)
        if (entry.senderBinding.backendId === id) drop(key, entry);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      clearInterval(timer);
      for (const cancel of [...listeners.values()]) cancel();
      for (const [id, entry] of entries) drop(id, entry);
      for (const value of [channel.PREPARE, channel.EXECUTE, channel.RECONCILE, channel.RELEASE]) {
        if ('removeHandler' in ipc && typeof ipc.removeHandler === 'function')
          ipc.removeHandler(value);
      }
    },
  };
}
