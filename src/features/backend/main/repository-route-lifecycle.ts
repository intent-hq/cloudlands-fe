/** Bound repository IPC. Routing evidence is separate from daemon admission. */
import { randomUUID } from 'node:crypto';
import type { IpcMain, IpcMainInvokeEvent, WebContents } from 'electron';
import { z } from 'zod';
import { IPC_CHANNELS } from '$shared/ipc-registry';
import {
  RepositoryRootIdentitySchema,
  repositoryRootKey,
  type RepositoryRootIdentity,
} from '$shared/types/repository-context';
import { getStrictBackendBindingForWebContents } from '../../../main/window-backend';
import type { JsonRpcClient } from './json-rpc-client';
import { createRepositoryRequestRoutes } from './repository-request-route';

/**
 * Future R/P adapter: main-owned non-reused lifetime, covering the original
 * admitted root, context revision, account/connection and authority generations.
 * allowsRequest validates the captured target/method, not daemon permission.
 * No adapter currently exists: production passes null and capture is unavailable.
 */
interface RepositoryLifetime {
  stamp: object;
  isCurrent(): boolean;
  allowsRequest(method: string, params: Readonly<Record<string, unknown>>): boolean;
}
interface Dependencies {
  readBackend(backendId: string): JsonRpcClient | undefined;
  resolveLifetime(
    capture: Readonly<{
      sender: WebContents;
      backendId: string;
      client: JsonRpcClient;
      connection: object;
      root: Readonly<RepositoryRootIdentity>;
    }>,
  ): Promise<RepositoryLifetime | null> | RepositoryLifetime | null;
  errorPayload(error: unknown): { code: string; message: string; data?: unknown; rpcCode?: number };
}

const strictRoot = z.discriminatedUnion('kind', [
  RepositoryRootIdentitySchema.options[0].strict(),
  RepositoryRootIdentitySchema.options[1].strict(),
]);
const captureSchema = z.object({ root: strictRoot }).strict();
const releaseSchema = captureSchema.extend({ id: z.string().min(1) }).strict();
const requestSchema = releaseSchema
  .extend({
    method: z.string().min(1),
    params: z.record(z.string(), z.unknown()),
    timeoutMs: z.number().finite().positive().max(300_000).optional(),
  })
  .strict();
const MAX_ROUTES = 256;
const MAX_SENDER_ROUTES = 32;
const MAX_REQUESTS = 64;
const TTL_MS = 300_000;
const CAPTURE_TIMEOUT_MS = 5_000;

function freezeJson(value: unknown): void {
  if (value === null || typeof value !== 'object') return;
  for (const child of Object.values(value)) freezeJson(child);
  Object.freeze(value);
}
const unavailable = () => ({
  ok: false as const,
  // i18n-ignore (internal IPC diagnostic; no product caller is enabled)
  error: { code: 'REPOSITORY_ROUTE_UNAVAILABLE', message: 'Repository route unavailable' },
});
const invalid = () => ({
  ok: false as const,
  // i18n-ignore (internal IPC validation diagnostic; no product caller is enabled)
  error: { code: 'INVALID_PARAMS', message: 'Invalid repository route request' },
});

export function registerRepositoryRouteHandlers(ipc: Pick<IpcMain, 'handle'>, deps: Dependencies) {
  type Routes = ReturnType<typeof createRepositoryRequestRoutes<WebContents, JsonRpcClient>>;
  type Entry = {
    sender: WebContents;
    frame: object;
    backendId: string;
    root: Readonly<RepositoryRootIdentity>;
    connection: object;
    lifetime: RepositoryLifetime;
    routes: Routes;
    binding: ReturnType<Routes['captureRepositoryRequestBinding']>;
    completions: Array<Awaited<ReturnType<Routes['backendRequestForCapturedBinding']>>>;
    requests: number;
    inFlight: boolean;
    expires: number;
  };
  const entries = new Map<string, Entry>();
  const pending = new Map<WebContents, number>();
  const observed = new Map<WebContents, () => void>();
  let disposed = false;
  const channels = IPC_CHANNELS.BACKEND.REPOSITORY;

  function drop(id: string, entry: Entry) {
    entry.routes.retireRepositoryRequestBinding(entry.sender, entry.binding);
    entries.delete(id);
  }
  function retireSender(sender: WebContents) {
    for (const [id, entry] of entries) if (entry.sender === sender) drop(id, entry);
  }
  function observe(sender: WebContents) {
    if (observed.has(sender)) return;
    const retire = () => retireSender(sender);
    const navigation = (_event: unknown, _url: string, inPlace: boolean, mainFrame: boolean) => {
      if (mainFrame && !inPlace) retire();
    };
    const cleanup = () => {
      retire();
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
  function sweep() {
    for (const [id, entry] of entries) if (Date.now() >= entry.expires) drop(id, entry);
  }
  const timer = setInterval(sweep, 30_000);
  timer.unref();

  ipc.handle(channels.CAPTURE, async (event, payload: unknown) => {
    const parsed = captureSchema.safeParse(payload);
    if (!parsed.success) return invalid();
    sweep();
    const sender = event.sender;
    const binding = getStrictBackendBindingForWebContents(sender);
    if (disposed || !binding || binding.frame !== event.senderFrame) return unavailable();
    const client = deps.readBackend(binding.backendId);
    const connection = client?.getRepositoryConnection();
    if (!client || !connection) return unavailable();
    const ownCount = [...entries.values()].filter((entry) => entry.sender === sender).length;
    const pendingCount = [...pending.values()].reduce((sum, count) => sum + count, 0);
    if (
      entries.size + pendingCount >= MAX_ROUTES ||
      ownCount + (pending.get(sender) ?? 0) >= MAX_SENDER_ROUTES
    )
      return unavailable();
    pending.set(sender, (pending.get(sender) ?? 0) + 1);
    const root = Object.freeze(parsed.data.root);
    let deadline: ReturnType<typeof setTimeout> | undefined;
    try {
      const lifetime = await Promise.race([
        deps.resolveLifetime(
          Object.freeze({ sender, backendId: binding.backendId, client, connection, root }),
        ),
        new Promise<null>((resolve) => {
          deadline = setTimeout(() => resolve(null), CAPTURE_TIMEOUT_MS);
          deadline.unref();
        }),
      ]);
      if (
        disposed ||
        !lifetime ||
        !lifetime.isCurrent() ||
        getStrictBackendBindingForWebContents(sender) !== binding ||
        event.senderFrame !== binding.frame ||
        deps.readBackend(binding.backendId) !== client ||
        client.getRepositoryConnection() !== connection
      )
        return unavailable();
      const routes = createRepositoryRequestRoutes<WebContents, JsonRpcClient>({
        readSenderBinding: getStrictBackendBindingForWebContents,
        readBackend: (id) => {
          const current = deps.readBackend(id);
          const session = current?.getRepositoryConnection();
          return current && session
            ? { client: current, incarnation: session, connected: true }
            : null;
        },
        readRepositoryLifetime: (owner, selectedRoot) =>
          owner === sender &&
          repositoryRootKey(selectedRoot) === repositoryRootKey(root) &&
          lifetime.isCurrent()
            ? lifetime.stamp
            : null,
      });
      const capture = routes.captureRepositoryRequestBinding(sender, root);
      const id = randomUUID();
      entries.set(id, {
        sender,
        frame: binding.frame,
        backendId: binding.backendId,
        root,
        connection,
        lifetime,
        routes,
        binding: capture,
        completions: [],
        requests: 0,
        inFlight: false,
        expires: Date.now() + TTL_MS,
      });
      observe(sender);
      return { ok: true as const, result: { id } };
    } catch {
      return unavailable();
    } finally {
      clearTimeout(deadline);
      const count = (pending.get(sender) ?? 1) - 1;
      if (count) pending.set(sender, count);
      else pending.delete(sender);
    }
  });

  function owned(event: IpcMainInvokeEvent, id: string, root: RepositoryRootIdentity) {
    sweep();
    const entry = entries.get(id);
    if (
      disposed ||
      !entry ||
      entry.sender !== event.sender ||
      entry.frame !== event.senderFrame ||
      repositoryRootKey(entry.root) !== repositoryRootKey(root)
    )
      return null;
    return entry;
  }

  ipc.handle(channels.REQUEST, async (event, payload: unknown) => {
    const parsed = requestSchema.safeParse(payload);
    if (!parsed.success) return invalid();
    const { id, root, method, params, timeoutMs } = parsed.data;
    const entry = owned(event, id, root);
    if (!entry || entry.inFlight || entry.requests >= MAX_REQUESTS) return unavailable();
    if (
      params.workspaceId !== root.workspaceId ||
      params.gitRootId !== (root.kind === 'registered' ? root.gitRootId : undefined)
    )
      return invalid();
    try {
      // IPC arguments are cloned; take a separate immutable JSON snapshot before
      // calling the trusted target validator. It cannot widen a later request.
      const capturedParams = JSON.parse(JSON.stringify(params)) as Record<string, unknown>;
      freezeJson(capturedParams);
      if (!entry.lifetime.isCurrent() || !entry.lifetime.allowsRequest(method, capturedParams))
        return unavailable();
      entry.requests += 1;
      entry.inFlight = true;
      const completion = await entry.routes.backendRequestForCapturedBinding(
        event.sender,
        entry.binding,
        (client) =>
          client.requestOnCapturedConnection(entry.connection, method, capturedParams, {
            timeoutMs,
          }),
      );
      // Retain the original settlement before checking UI eligibility. Rejections
      // may have effects; do not replace a native failed/uncertain result with success.
      entry.completions.push(completion);
      if (entries.get(id) !== entry || event.senderFrame !== entry.frame) return unavailable();
      const settlement = entry.routes.readRetainedRepositoryOperation(
        event.sender,
        entry.binding,
        completion,
      );
      if (!settlement) return unavailable();
      const current = entry.routes.isCapturedRepositoryRequestCurrent(event.sender, entry.binding);
      return {
        ok: true as const,
        result: {
          operationId: randomUUID(),
          current,
          settlement:
            settlement.status === 'fulfilled'
              ? settlement
              : { status: 'rejected' as const, error: deps.errorPayload(settlement.reason) },
        },
      };
    } catch {
      return unavailable();
    } finally {
      if (entry) entry.inFlight = false;
    }
  });

  ipc.handle(channels.RELEASE, (event, payload: unknown) => {
    const parsed = releaseSchema.safeParse(payload);
    if (!parsed.success) return invalid();
    const entry = owned(event, parsed.data.id, parsed.data.root);
    if (!entry) return unavailable();
    drop(parsed.data.id, entry);
    return { ok: true as const, result: undefined };
  });

  return {
    retireBackend(backendId: string) {
      for (const entry of entries.values())
        if (entry.backendId === backendId)
          entry.routes.retireRepositoryRequestBinding(entry.sender, entry.binding);
    },
    dispose() {
      disposed = true;
      clearInterval(timer);
      for (const [id, entry] of entries) drop(id, entry);
      for (const cleanup of observed.values()) cleanup();
    },
  };
}
