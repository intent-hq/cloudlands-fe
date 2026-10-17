/** Main-owned monitor transport. Captured routing is not daemon authorization. */
import { randomUUID } from 'node:crypto';
import type { IpcMain, IpcMainInvokeEvent, WebContents } from 'electron';
import { z } from 'zod';
import { IPC_CHANNELS } from '$shared/ipc-registry';
import { supportsReviewMonitoring, REVIEW_MONITOR_HISTORY_METHODS } from '$shared/types/pr-monitor';
import {
  getStrictBackendBindingForWebContents,
  onStrictBackendBindingRetired,
} from '../../../main/window-backend';
import { JsonRpcClient } from './json-rpc-client';

const channels = IPC_CHANNELS.BACKEND.PR_MONITOR;
const workspace = z.object({ workspaceId: z.string().min(1).max(128) }).strict();
const capture = workspace.extend({ reviewMonitoring: z.unknown().optional() });
const owned = workspace.extend({ id: z.string().uuid() }).strict();
const request = owned
  .extend({
    method: z.enum([
      'prMonitor.list',
      'prMonitor.cancel',
      'prMonitor.flush',
      'events.subscribe',
      'events.unsubscribe',
    ]),
    params: z.record(z.string(), z.unknown()),
  })
  .strict();
const unavailable = () => ({
  ok: false,
  // i18n-ignore -- IPC diagnostic logged by monitor sagas, never rendered as UI copy.
  error: { code: 'PR_MONITOR_SESSION_RETIRED', message: 'Monitor connection unavailable' },
});

export function registerPrMonitorHandlers(
  ipc: Pick<IpcMain, 'handle'>,
  deps: {
    readBackend(id: string): JsonRpcClient | undefined;
    /** Trusted composition gate. Production registration leaves this absent. */
    recipientVersion?: number;
    createRecipientClient?(
      original: JsonRpcClient,
      hello: Readonly<{
        clientId: string;
        connectionRole: 'review-monitor';
        capabilities: { reviewMonitoring: number };
      }>,
    ): JsonRpcClient;
    errorPayload(error: unknown): {
      code: string;
      message: string;
      rpcCode?: number;
      data?: unknown;
    };
  },
) {
  type Entry = {
    sender: WebContents;
    binding: NonNullable<ReturnType<typeof getStrictBackendBindingForWebContents>>;
    client: JsonRpcClient;
    connection: NonNullable<ReturnType<JsonRpcClient['getRepositoryConnection']>>;
    sourceClient: JsonRpcClient;
    sourceConnection: NonNullable<ReturnType<JsonRpcClient['getRepositoryConnection']>>;
    workspaceId: string;
    subscriptions: Set<string>;
    stop: () => void;
  };
  const entries = new Map<string, Entry>();
  type Document = {
    binding: Entry['binding'];
    sender: WebContents;
    sourceClient: JsonRpcClient;
    sourceConnection: Entry['connection'];
    version: number;
    client: JsonRpcClient;
    connection?: Entry['connection'];
    ready: Promise<void>;
    chatSubscriptions: Set<string>;
    pendingChats: number;
    earlyChat: Array<{ method: string; params?: unknown }>;
    stop(): void;
  };
  const documents = new Map<Entry['binding'], Document>();
  const recoveries = new Map<Entry['binding'], () => void>();
  let disposed = false;
  const currentDocument = (document: Document) =>
    !disposed &&
    documents.get(document.binding) === document &&
    getStrictBackendBindingForWebContents(document.sender) === document.binding &&
    deps.readBackend(document.binding.backendId) === document.sourceClient &&
    document.sourceClient.getRepositoryConnection() === document.sourceConnection &&
    !!document.connection &&
    document.client.getRepositoryConnection() === document.connection;
  const sendChat = (document: Document, notification: { method: string; params?: unknown }) => {
    if (!currentDocument(document) || document.sender.isDestroyed()) return;
    try {
      document.binding.frame.send(IPC_CHANNELS.BACKEND.NOTIFICATION, notification);
    } catch {
      /* Document gone. */
    }
  };
  const current = (entry: Entry) =>
    !disposed &&
    getStrictBackendBindingForWebContents(entry.sender) === entry.binding &&
    deps.readBackend(entry.binding.backendId) === entry.sourceClient &&
    entry.sourceClient.getRepositoryConnection() === entry.sourceConnection &&
    entry.client.getRepositoryConnection() === entry.connection;
  function dropDocument(document: Document) {
    if (documents.get(document.binding) !== document) return;
    documents.delete(document.binding);
    document.stop();
    for (const [id, entry] of entries) if (entry.client === document.client) drop(id, entry);
    document.client.dispose();
  }
  function recoverDocument(previous: Document) {
    const { binding, sender, sourceClient, sourceConnection, version } = previous;
    if (recoveries.has(binding)) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let delay = 1_000;
    const currentSource = () =>
      !disposed &&
      recoveries.get(binding) === cancel &&
      getStrictBackendBindingForWebContents(sender) === binding &&
      deps.readBackend(binding.backendId) === sourceClient &&
      sourceClient.getRepositoryConnection() === sourceConnection;
    const cancel = () => {
      if (recoveries.get(binding) !== cancel) return;
      recoveries.delete(binding);
      clearTimeout(timer);
      offBinding();
      offSource();
    };
    const offBinding = onStrictBackendBindingRetired(sender, cancel);
    const offSource = sourceClient.onRepositoryConnectionEvent(() => {
      if (!currentSource()) cancel();
    });
    recoveries.set(binding, cancel);
    const retry = async () => {
      if (!currentSource()) return cancel();
      try {
        const document = await recipientDocument(
          sender,
          binding,
          sourceClient,
          sourceConnection,
          version,
        );
        if (!currentSource() || !currentDocument(document)) return cancel();
        cancel();
        // Only this still-current document may resume reads and subscriptions.
        binding.frame.send(channels.READY, { attachment: true });
      } catch {
        if (!currentSource()) return cancel();
        delay = Math.min(delay * 2, 30_000);
        timer = setTimeout(() => void retry(), delay);
      }
    };
    timer = setTimeout(() => void retry(), delay);
  }
  async function recipientDocument(
    sender: WebContents,
    binding: Entry['binding'],
    sourceClient: JsonRpcClient,
    sourceConnection: Entry['connection'],
    version: number,
  ): Promise<Document> {
    const identity = sourceClient.getAcknowledgedHelloIdentity(sourceConnection);
    if (
      !supportsReviewMonitoring(sourceConnection.reviewMonitoring) ||
      !identity ||
      identity.connectionRole !== undefined
    )
      throw new Error('Monitor attachment source unavailable');
    const existing = documents.get(binding);
    if (existing) {
      await existing.ready;
      if (!currentDocument(existing)) throw new Error('Monitor document retired');
      return existing;
    }
    if (documents.size >= 256) throw new Error('Monitor recipient limit');
    const hello = Object.freeze({
      clientId: identity.clientId,
      connectionRole: 'review-monitor' as const,
      capabilities: Object.freeze({ reviewMonitoring: version }),
    });
    const client =
      deps.createRecipientClient?.(sourceClient, hello) ??
      new JsonRpcClient({
        config: { ...sourceClient.getConfig() },
        // Attach to the acknowledged logical client without copying its profile or browser role.
        helloParams: () => hello,
        heartbeatIntervalMs: 0,
      });
    if (client === sourceClient) throw new Error('Monitor recipient must own its connection');
    let resolve!: () => void;
    let reject!: (error: Error) => void;
    const ready = new Promise<void>((yes, no) => {
      resolve = yes;
      reject = no;
    });
    const document: Document = {
      binding,
      sender,
      sourceClient,
      sourceConnection,
      version,
      client,
      ready,
      chatSubscriptions: new Set(),
      pendingChats: 0,
      earlyChat: [],
      stop: () => {},
    };
    documents.set(binding, document);
    const currentSource = () =>
      !disposed &&
      documents.get(binding) === document &&
      getStrictBackendBindingForWebContents(sender) === binding &&
      deps.readBackend(binding.backendId) === sourceClient &&
      sourceClient.getRepositoryConnection() === sourceConnection;
    const offBinding = onStrictBackendBindingRetired(sender, () => dropDocument(document));
    const offSource = sourceClient.onRepositoryConnectionEvent(() => {
      if (!currentSource()) dropDocument(document);
    });
    const offClient = client.onRepositoryConnectionEvent((event) => {
      if (event.type === 'closed' || (event.type === 'identity-retired' && document.connection)) {
        const recover = !!document.connection && currentSource();
        dropDocument(document);
        if (recover) recoverDocument(document);
      }
      if (
        event.type !== 'notification' ||
        !currentDocument(document) ||
        event.incarnation !== document.connection?.incarnation ||
        event.notification.method !== 'subscription.push'
      )
        return;
      const id = (event.notification.params as { subscriptionId?: unknown } | undefined)
        ?.subscriptionId;
      if (typeof id !== 'string') return;
      if (document.chatSubscriptions.has(id)) sendChat(document, event.notification);
      else if (document.pendingChats > 0) {
        if (document.earlyChat.length >= 256) return dropDocument(document);
        document.earlyChat.push(event.notification);
      }
    });
    const onStatus = (status: string) => {
      if (status !== 'connected') return;
      const connection = client.getRepositoryConnection();
      const acknowledged = connection && client.getAcknowledgedHelloIdentity(connection);
      if (
        !currentSource() ||
        !connection ||
        !supportsReviewMonitoring(connection.reviewMonitoring) ||
        acknowledged?.clientId !== identity.clientId ||
        acknowledged.connectionRole !== 'review-monitor'
      )
        return dropDocument(document);
      document.connection = connection;
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => dropDocument(document), 5_000);
    document.stop = () => {
      clearTimeout(timer);
      offBinding();
      offSource();
      offClient();
      client.off('status', onStatus);
      reject(new Error('Monitor document retired'));
    };
    client.on('status', onStatus);
    client.start();
    await ready;
    if (!currentSource() || client.getRepositoryConnection() !== document.connection)
      throw new Error('Monitor document retired');
    return document;
  }
  const send = (entry: Entry, channel: string, value: unknown) => {
    // A replacement document must never receive the old document's output.
    if (entry.sender.mainFrame !== entry.binding.frame || entry.sender.isDestroyed()) return;
    try {
      entry.binding.frame.send(channel, value);
    } catch {
      /* Document gone. */
    }
  };
  function drop(id: string, entry: Entry) {
    if (entries.get(id) !== entry) return;
    entries.delete(id);
    entry.stop();
    send(entry, channels.RETIRED, { id });
    for (const subscriptionId of entry.subscriptions) {
      void entry.client
        .requestOnCapturedConnection(entry.connection, 'events.unsubscribe', {
          workspaceId: entry.workspaceId,
          subscriptionId,
        })
        .catch(() => {});
    }
  }
  ipc.handle(channels.CAPTURE, async (event, payload: unknown) => {
    const parsed = capture.safeParse(payload);
    const binding = getStrictBackendBindingForWebContents(event.sender);
    if (!parsed.success || disposed || !binding || binding.frame !== event.senderFrame)
      return unavailable();
    const sourceClient = deps.readBackend(binding.backendId);
    const sourceConnection = sourceClient?.getRepositoryConnection();
    let client = sourceClient;
    let connection = sourceConnection;
    if (
      !client ||
      !connection ||
      entries.size >= 256 ||
      [...entries.values()].filter((entry) => entry.sender === event.sender).length >= 64
    )
      return unavailable();
    let qualified = false;
    if (
      supportsReviewMonitoring(deps.recipientVersion) &&
      supportsReviewMonitoring(parsed.data.reviewMonitoring) &&
      supportsReviewMonitoring(connection.reviewMonitoring)
    ) {
      try {
        const document = await recipientDocument(
          event.sender,
          binding,
          client,
          connection,
          Math.min(deps.recipientVersion!, parsed.data.reviewMonitoring as number),
        );
        client = document.client;
        connection = document.connection;
        qualified = true;
      } catch {
        return unavailable();
      }
    } else {
      recoveries.get(binding)?.();
      const previous = documents.get(binding);
      if (previous) dropDocument(previous);
    }
    if (
      !connection ||
      !sourceClient ||
      !sourceConnection ||
      disposed ||
      getStrictBackendBindingForWebContents(event.sender) !== binding ||
      sourceClient.getRepositoryConnection() !== sourceConnection
    )
      return unavailable();
    const id = randomUUID();
    const entry: Entry = {
      sender: event.sender,
      binding,
      client,
      connection,
      sourceClient,
      sourceConnection,
      workspaceId: parsed.data.workspaceId,
      subscriptions: new Set(),
      stop: () => {},
    };
    entries.set(id, entry);
    const offBinding = onStrictBackendBindingRetired(entry.sender, () => drop(id, entry));
    const offConnection = client.onRepositoryConnectionEvent((notice) => {
      if (!current(entry)) {
        drop(id, entry);
        return;
      }
      if (
        notice.type !== 'notification' ||
        notice.incarnation !== connection.incarnation ||
        notice.notification.method !== 'events.event'
      )
        return;
      const params = notice.notification.params as
        { subscriptionId?: string; event?: { workspaceId?: string; type?: string } } | undefined;
      if (
        params?.event?.workspaceId !== entry.workspaceId ||
        !params.event.type?.startsWith('prMonitor:')
      )
        return;
      if (!params.subscriptionId || !entry.subscriptions.has(params.subscriptionId)) return;
      send(entry, channels.NOTIFICATION, { id, notification: notice.notification });
    });
    entry.stop = () => {
      offBinding();
      offConnection();
    };
    return {
      ok: true,
      result: {
        origin: { sessionId: id, backendId: binding.backendId, workspaceId: entry.workspaceId },
        support: supportsReviewMonitoring(connection.reviewMonitoring)
          ? qualified
            ? 'supported'
            : 'consumer-pending'
          : 'unsupported',
      },
    };
  });
  function find(event: IpcMainInvokeEvent, id: string, workspaceId: string) {
    const entry = entries.get(id);
    if (
      !entry ||
      entry.sender !== event.sender ||
      entry.binding.frame !== event.senderFrame ||
      entry.workspaceId !== workspaceId
    )
      return undefined;
    if (!current(entry)) {
      drop(id, entry);
      return undefined;
    }
    return entry;
  }
  ipc.handle(channels.REQUEST, async (event, payload: unknown) => {
    const parsed = request.safeParse(payload);
    if (!parsed.success) return unavailable();
    const { id, workspaceId, method, params } = parsed.data;
    const entry = find(event, id, workspaceId);
    if (!entry || params.workspaceId !== workspaceId) return unavailable();
    const valid =
      method === 'prMonitor.list'
        ? workspace.safeParse(params).success
        : method === 'events.subscribe'
          ? workspace
              .extend({ eventTypes: z.tuple([z.literal('prMonitor:*')]) })
              .strict()
              .safeParse(params).success
          : method === 'events.unsubscribe'
            ? workspace
                .extend({ subscriptionId: z.string().min(1) })
                .strict()
                .safeParse(params).success && entry.subscriptions.has(String(params.subscriptionId))
            : workspace
                .extend({
                  monitorId: z.string().min(1),
                  ...(method === 'prMonitor.flush' ? { check: z.boolean().optional() } : {}),
                })
                .strict()
                .safeParse(params).success;
    if (!valid) return unavailable();
    try {
      const result = await entry.client.requestOnCapturedConnection(
        entry.connection,
        method,
        params,
      );
      const subscriptionId =
        method === 'events.subscribe'
          ? (result as { subscriptionId?: string })?.subscriptionId
          : undefined;
      if (!current(entry) || entries.get(id) !== entry) {
        if (subscriptionId)
          void entry.client
            .requestOnCapturedConnection(entry.connection, 'events.unsubscribe', {
              workspaceId,
              subscriptionId,
            })
            .catch(() => {});
        return unavailable();
      }
      if (subscriptionId) entry.subscriptions.add(subscriptionId);
      if (method === 'events.unsubscribe')
        entry.subscriptions.delete(String(params.subscriptionId));
      return { ok: true, result };
    } catch (error) {
      return current(entry) ? { ok: false, error: deps.errorPayload(error) } : unavailable();
    }
  });
  ipc.handle(channels.RELEASE, (event, payload: unknown) => {
    const parsed = owned.safeParse(payload);
    if (!parsed.success) return unavailable();
    const entry = find(event, parsed.data.id, parsed.data.workspaceId);
    if (entry) drop(parsed.data.id, entry);
    return { ok: true, result: undefined };
  });
  return {
    /** Undefined means a legacy/general request; a selected document never falls back. */
    requestHistory(
      event: IpcMainInvokeEvent,
      method: string,
      params: unknown,
      recipientVersion: unknown,
      timeoutMs?: number,
    ) {
      if (
        !REVIEW_MONITOR_HISTORY_METHODS.has(method) ||
        !supportsReviewMonitoring(deps.recipientVersion)
      )
        return undefined;
      const binding = getStrictBackendBindingForWebContents(event.sender);
      if (!binding || binding.frame !== event.senderFrame) return Promise.resolve(unavailable());
      if (!supportsReviewMonitoring(recipientVersion)) {
        recoveries.get(binding)?.();
        const previous = binding && documents.get(binding);
        if (previous) dropDocument(previous);
        return undefined;
      }
      const source = deps.readBackend(binding.backendId);
      const connection = source?.getRepositoryConnection();
      if (!source || !connection || disposed) return Promise.resolve(unavailable());
      if (!supportsReviewMonitoring(connection.reviewMonitoring)) return undefined;
      return (async () => {
        if (disposed || binding.frame !== event.senderFrame) return unavailable();
        let document: Document | undefined;
        let subscribing = false;
        try {
          // An unsubscribe belongs to an already captured subscription, never a new socket.
          if (method === 'chat.unsubscribe' && !documents.has(binding)) return unavailable();
          document = await recipientDocument(
            event.sender,
            binding,
            source,
            connection,
            Math.min(deps.recipientVersion!, recipientVersion as number),
          );
          if (!currentDocument(document)) return unavailable();
          const id = (params as { subscriptionId?: unknown } | undefined)?.subscriptionId;
          if (
            method === 'chat.unsubscribe' &&
            (typeof id !== 'string' || !document.chatSubscriptions.has(id))
          )
            return unavailable();
          if (method === 'chat.subscribe') {
            document.pendingChats++;
            subscribing = true;
          }
          const result = await document.client.requestOnCapturedConnection(
            document.connection!,
            method,
            params,
            { timeoutMs },
          );
          if (!currentDocument(document)) return unavailable();
          if (method === 'chat.subscribe') {
            const subscriptionId = (result as { subscriptionId?: unknown } | undefined)
              ?.subscriptionId;
            if (typeof subscriptionId === 'string' && subscriptionId.length > 0) {
              document.chatSubscriptions.add(subscriptionId);
              const pending = document.earlyChat;
              document.earlyChat = [];
              for (const notice of pending) {
                if (
                  (notice.params as { subscriptionId?: unknown } | undefined)?.subscriptionId ===
                  subscriptionId
                )
                  sendChat(document, notice);
                else document.earlyChat.push(notice);
              }
            }
          } else if (method === 'chat.unsubscribe') document.chatSubscriptions.delete(id as string);
          return { ok: true, result };
        } catch (error) {
          return document && currentDocument(document)
            ? { ok: false, error: deps.errorPayload(error) }
            : unavailable();
        } finally {
          if (document && subscribing) {
            document.pendingChats--;
            if (document.pendingChats === 0) document.earlyChat = [];
          }
        }
      })();
    },
    retireBackend(backendId: string) {
      for (const [binding, cancel] of recoveries) if (binding.backendId === backendId) cancel();
      for (const document of documents.values())
        if (document.binding.backendId === backendId) dropDocument(document);
      for (const [id, entry] of entries) if (entry.binding.backendId === backendId) drop(id, entry);
    },
    dispose() {
      disposed = true;
      for (const cancel of recoveries.values()) cancel();
      for (const document of documents.values()) dropDocument(document);
      for (const [id, entry] of entries) drop(id, entry);
    },
  };
}
