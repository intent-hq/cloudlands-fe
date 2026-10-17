import { randomUUID } from 'node:crypto';
import type { IpcMain, IpcMainInvokeEvent } from 'electron';
import { IPC_CHANNELS } from '$shared/ipc-registry';
import { getPhysicalRequestCompletion } from '$shared/event-recovery/session';
import {
  getStrictBackendBindingForWebContents,
  onStrictBackendBindingRetired,
} from '../../../main/window-backend';
import type { JsonRpcClient } from './json-rpc-client';

// Includes in-flight ordinary calls and unclaimed completed receipts. Reserve before
// dispatch: a renderer that never claims its receipts cannot grow this registry.
const MAX_COMPLETIONS = 256;
type ErrorPayload = { code: string; message: string; data?: unknown; rpcCode?: number };
type Outcome = { retired: boolean; errors: ErrorPayload[] };
const retired = (): Outcome => ({ retired: true, errors: [] });
const unavailable = () => ({
  ok: false as const,
  // i18n-ignore (internal receipt diagnostic; renderer converts failed claims to retired outcomes)
  error: { code: 'UNAVAILABLE', message: 'Request completion unavailable' },
});

/** One-shot, sender/document-scoped physical outcomes, separate from caller deadlines. */
export function registerOrdinaryRequestCompletions(
  ipc: Pick<IpcMain, 'handle'>,
  deps: {
    readBackend(id: string): JsonRpcClient | undefined;
    errorPayload(error: unknown): ErrorPayload;
  },
) {
  type Binding = NonNullable<ReturnType<typeof getStrictBackendBindingForWebContents>>;
  type Entry = {
    sender: IpcMainInvokeEvent['sender'];
    binding: Binding;
    claimed: boolean;
    done: boolean;
    outcome: Promise<Outcome>;
    settle(outcome: Outcome): void;
    stop(): void;
    current(): boolean;
  };
  const entries = new Map<string, Entry>();
  const documents = new Map<
    IpcMainInvokeEvent['sender'],
    { callbacks: Set<() => void>; stop(): void }
  >();
  function watchDocument(sender: IpcMainInvokeEvent['sender'], callback: () => void) {
    let group = documents.get(sender);
    if (!group) {
      const callbacks = new Set<() => void>();
      const gone = () => {
        for (const fn of [...callbacks]) fn();
      };
      const navigation = (_event: unknown, _url: string, inPlace: boolean, mainFrame: boolean) => {
        if (mainFrame && !inPlace) gone();
      };
      sender.on('did-start-navigation', navigation);
      sender.on('render-process-gone', gone);
      sender.once('destroyed', gone);
      group = {
        callbacks,
        stop: () => {
          sender.removeListener('did-start-navigation', navigation);
          sender.removeListener('render-process-gone', gone);
          sender.removeListener('destroyed', gone);
        },
      };
      documents.set(sender, group);
    }
    group.callbacks.add(callback);
    return () => {
      group.callbacks.delete(callback);
      if (group.callbacks.size === 0) {
        group.stop();
        documents.delete(sender);
      }
    };
  }
  let disposed = false;
  const remove = (id: string) => {
    const entry = entries.get(id);
    entries.delete(id);
    entry?.stop();
  };
  ipc.handle(IPC_CHANNELS.BACKEND.REQUEST_COMPLETION, async (event, payload: unknown) => {
    const id = payload && typeof payload === 'object' && 'id' in payload ? payload.id : undefined;
    const entry = typeof id === 'string' ? entries.get(id) : undefined;
    if (
      !entry ||
      entry.claimed ||
      entry.sender !== event.sender ||
      entry.binding.frame !== event.senderFrame
    )
      return unavailable();
    entry.claimed = true;
    try {
      const outcome = await entry.outcome;
      // Authority can retire between wire settlement and the renderer claiming it.
      return { ok: true, result: entry.current() ? outcome : retired() };
    } finally {
      remove(id as string);
    }
  });
  return {
    async run<T>(
      event: IpcMainInvokeEvent,
      backendId: string,
      client: JsonRpcClient,
      operation: () => Promise<T>,
    ) {
      const binding = getStrictBackendBindingForWebContents(event.sender);
      if (
        disposed ||
        entries.size >= MAX_COMPLETIONS ||
        !binding ||
        binding.frame !== event.senderFrame
      )
        return unavailable();
      const connection = client.getRepositoryConnection();
      const id = randomUUID();
      let resolve!: (outcome: Outcome) => void;
      const outcome = new Promise<Outcome>((done) => {
        resolve = done;
      });
      let authorityRetired = false;
      const entry: Entry = {
        sender: event.sender,
        binding,
        claimed: false,
        done: false,
        outcome,
        stop: () => {},
        current: () =>
          !disposed &&
          !authorityRetired &&
          !event.sender.isDestroyed() &&
          event.sender.mainFrame === binding.frame &&
          getStrictBackendBindingForWebContents(event.sender) === binding &&
          deps.readBackend(backendId) === client &&
          client.getRepositoryConnection() === connection,
        settle: (value) => {
          if (entry.done) return;
          entry.done = true;
          resolve(value);
        },
      };
      const invalidate = () => {
        authorityRetired = true;
      };
      const offBinding = onStrictBackendBindingRetired(event.sender, invalidate);
      const offConnection = client.onRepositoryConnectionEvent(() => {
        if (!entry.current()) invalidate();
      });
      const offDocument = watchDocument(event.sender, () => {
        invalidate();
        entry.settle(retired());
        remove(id);
      });
      entry.stop = () => {
        offBinding();
        offConnection();
        offDocument();
      };
      entries.set(id, entry);
      try {
        const result = await operation();
        remove(id);
        return { ok: true as const, result };
      } catch (error) {
        const completion = getPhysicalRequestCompletion(error);
        if (!completion) {
          remove(id);
          return { ok: false as const, error: deps.errorPayload(error) };
        }
        void completion.then(
          (value) =>
            entry.settle(
              value.retired || !entry.current()
                ? retired()
                : {
                    retired: false,
                    errors: value.errors.map(deps.errorPayload),
                  },
            ),
          () => entry.settle(retired()),
        );
        return { ok: false as const, error: deps.errorPayload(error), completionId: id };
      }
    },
    dispose() {
      disposed = true;
      for (const [id, entry] of entries) {
        entry.settle(retired());
        remove(id);
      }
    },
  };
}
