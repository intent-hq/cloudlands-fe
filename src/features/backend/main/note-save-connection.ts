/** One prospective operation/connection association. This is not a save issuer. */
import { randomUUID } from 'node:crypto';
import type { IpcMain, IpcMainInvokeEvent } from 'electron';
import { IPC_CHANNELS } from '$shared/ipc-registry';
import {
  copyNoteSaveData,
  noteSaveRecord,
  noteSaveToken,
  noteSaveUnavailable,
  parseNoteSaveCommand,
  parseNoteSaveIdentity,
  sameNoteSaveScope,
  validateNoteSaveOutcome,
  type NoteSaveConnectionIdentity,
  type NoteSaveConnectionCommand,
  type NoteSaveConnectionResult,
} from '$shared/types/note-save-connection';
import {
  getStrictBackendBindingForWebContents,
  onStrictBackendBindingRetired,
} from '../../../main/window-backend';
import type { JsonRpcClient } from './json-rpc-client';

interface Dependencies {
  readBackend(id: string): JsonRpcClient | undefined;
  credentialGeneration(id: string): number;
}
type Slot = {
  id: string;
  event: IpcMainInvokeEvent;
  op: NoteSaveConnectionIdentity;
  binding: NonNullable<ReturnType<typeof getStrictBackendBindingForWebContents>>;
  client: JsonRpcClient;
  connection: NonNullable<ReturnType<JsonRpcClient['getRepositoryConnection']>>;
  generation: number;
  deps: Dependencies;
  retired: boolean;
  unknown: boolean;
  commit: boolean;
  status: boolean;
  receiptCalls: number;
  lexicalCalls: number;
  sourceEntered: boolean;
  outcome?: Record<string, unknown>;
  source?: { snapshotId: string; expiresAt: string };
  pending?: Promise<NoteSaveConnectionResult>;
  release?: Promise<unknown>;
  stops: Array<() => void>;
};
// Global across handler/sender lifetimes. Unknown work is never evicted for capacity.
let occupied: object | Slot | undefined;
const channels = IPC_CHANNELS.BACKEND.NOTE_SAVE_CONNECTION;
function retire(s: Slot) {
  if (s.retired) return;
  s.retired = true;
  try {
    s.event.senderFrame?.send(channels.RETIRED, { id: s.id });
  } catch {
    /* Lost notification is not release. */
  }
}
function current(s: Slot): boolean {
  if (s.retired) return false;
  try {
    const binding = getStrictBackendBindingForWebContents(s.event.sender);
    const connection = s.client.getRepositoryConnection();
    const client = s.deps.readBackend(s.op.scope.backendId);
    const generation = s.deps.credentialGeneration(s.op.scope.backendId);
    const deadline =
      s.source?.expiresAt ??
      (s.outcome?.kind === 'noteCommitReceipt'
        ? String(s.outcome.receiptExpiresAt)
        : !s.commit
          ? s.op.expiresAt
          : undefined);
    const time = Date.now();
    if (
      occupied === s &&
      !s.retired &&
      binding === s.binding &&
      s.event.senderFrame === binding?.frame &&
      client === s.client &&
      generation === s.generation &&
      connection === s.connection &&
      Number.isFinite(time) &&
      (deadline === undefined || time < Date.parse(deadline))
    )
      return true;
  } catch {
    /* Callback loss is terminal. */
  }
  retire(s);
  return false;
}
function addressed(event: IpcMainInvokeEvent, raw: unknown, request = false) {
  const v = noteSaveRecord(copyNoteSaveData(raw));
  if (Object.keys(v).some((k) => k !== 'id' && (!request || k !== 'command')))
    noteSaveUnavailable();
  const s = occupied as Slot | undefined;
  if (
    !s?.op ||
    !noteSaveToken(v.id) ||
    v.id !== s.id ||
    event.sender !== s.event.sender ||
    event.senderFrame !== s.event.senderFrame
  )
    noteSaveUnavailable();
  return { slot: s, command: request ? parseNoteSaveCommand(v.command) : undefined };
}
function wire(s: Slot, c: NoteSaveConnectionCommand) {
  const op = s.op,
    base = { ...op.scope, operationId: op.operationId, headerDigest: op.headerDigest };
  const now = Date.now();
  if (!Number.isFinite(now)) noteSaveUnavailable();
  if (c.kind === 'commit' || c.kind === 'status') {
    if (c.kind === 'commit' ? s.commit || now >= Date.parse(op.expiresAt) : !s.commit || s.status)
      noteSaveUnavailable();
    if (c.kind === 'commit') s.commit = true;
    else s.status = true;
    return {
      method: c.kind === 'commit' ? 'note.operation.commit' : 'note.operationStatus',
      params: { ...base, payloadDigest: op.payloadDigest },
    };
  }
  const r = s.outcome;
  if (!r || r.kind !== 'noteCommitReceipt') noteSaveUnavailable();
  if (c.kind === 'receipt') {
    if (++s.receiptCalls > 768 || now >= Date.parse(String(r.receiptExpiresAt)))
      noteSaveUnavailable();
    const root =
      c.output === 'mapping' ? r.mappingRef : c.output === 'effects' ? r.effectsRef : r.inverseRef;
    if (c.output !== 'detail' && c.ref !== root) noteSaveUnavailable();
    return {
      method: 'note.operation.read',
      params: {
        ...base,
        kind: c.output,
        ref: c.ref,
        ...(c.cursor === undefined ? {} : { cursor: c.cursor }),
        maxItems: c.output === 'detail' ? 16 : c.output === 'inverseText' ? 1 : 64,
        maxWireBytes: 8192,
        ...(c.output === 'inverseText'
          ? {
              textId: c.textId,
              maxSourceBytes: 4096,
              ...(c.offset === undefined ? {} : { offset: c.offset }),
            }
          : {}),
      },
    };
  }
  if (++s.lexicalCalls > 96) noteSaveUnavailable();
  const address = { workspaceId: op.scope.workspaceId, noteId: op.scope.noteId };
  if (c.kind === 'source') {
    if (s.sourceEntered) noteSaveUnavailable();
    s.sourceEntered = true;
    return {
      method: 'note.get',
      params: {
        ...address,
        page: {
          kind: 'source',
          at: 0,
          sourceRevision: r.afterRevision,
          noteInstanceId: op.scope.noteInstanceId,
          maxSourceBytes: 4096,
          maxWireBytes: 8192,
          maxItems: 64,
        },
      },
    };
  }
  if (!s.source || now >= Date.parse(s.source.expiresAt)) noteSaveUnavailable();
  return {
    method: 'note.get',
    params: {
      ...address,
      page: {
        kind: 'context',
        contextRef: c.contextRef,
        ...(c.cursor === undefined ? {} : { cursor: c.cursor }),
        maxWireBytes: 8192,
        maxItems: 64,
      },
    },
  };
}
function validate(s: Slot, c: NoteSaveConnectionCommand, value: unknown) {
  const v = noteSaveRecord(value),
    op = s.op;
  if (c.kind === 'commit' || c.kind === 'status') {
    validateNoteSaveOutcome(v, op);
    if (s.outcome?.kind === 'noteCommitReceipt') {
      if (JSON.stringify(s.outcome) !== JSON.stringify(v)) noteSaveUnavailable();
    } else s.outcome = v;
    return;
  }
  if (!sameNoteSaveScope(v.scope, op)) noteSaveUnavailable();
  const r = s.outcome!;
  if (c.kind === 'receipt') {
    if (
      v.kind !== 'noteOperationPage' ||
      v.outputKind !== c.output ||
      v.operationId !== op.operationId ||
      v.headerDigest !== op.headerDigest ||
      v.payloadDigest !== op.payloadDigest ||
      v.viewId !== r.viewId ||
      v.expiresAt !== r.receiptExpiresAt ||
      v.sourceLength !== (c.output === 'inverse' || c.output === 'inverseText' ? 3 : 2)
    )
      noteSaveUnavailable();
    return;
  }
  if (
    v.sourceRevision !== r.afterRevision ||
    !noteSaveToken(v.snapshotId) ||
    typeof v.expiresAt !== 'string' ||
    !Number.isFinite(Date.parse(v.expiresAt))
  )
    noteSaveUnavailable();
  if (c.kind === 'source') {
    const range = noteSaveRecord(v.range);
    if (
      v.kind !== 'noteSourcePage' ||
      v.text !== 'aXb' ||
      v.sourceLength !== 3 ||
      range.start !== 0 ||
      range.end !== 3 ||
      v.nextCursor !== null ||
      !noteSaveToken(v.contextRef)
    )
      noteSaveUnavailable();
    const identity = { snapshotId: v.snapshotId, expiresAt: v.expiresAt };
    copyNoteSaveData(identity, 1024, true);
    s.source = identity;
  } else if (
    v.kind !== 'noteContextPage' ||
    v.snapshotId !== s.source?.snapshotId ||
    v.expiresAt !== s.source.expiresAt
  )
    noteSaveUnavailable();
}
function release(s: Slot) {
  if (s.release) return Promise.reject(new Error('Note release already consumed'));
  let yes!: (v: unknown) => void, no!: (e: unknown) => void;
  s.release = new Promise((resolve, reject) => {
    yes = resolve;
    no = reject;
  });
  retire(s); // Notification may reenter; completion is already owned.
  void (async () => {
    try {
      try {
        await s.pending;
      } catch {
        /* Independent unknown latch below. */
      }
      for (const stop of s.stops.splice(0)) {
        try {
          stop();
        } catch {
          s.unknown = true;
        }
      }
      if (s.unknown || occupied !== s) noteSaveUnavailable();
      const ack = { id: s.id, operationId: s.op.operationId, released: true };
      occupied = undefined;
      yes(ack);
    } catch (e) {
      no(e);
    }
  })();
  return s.release;
}
export function registerNoteSaveConnectionHandlers(
  ipc: Pick<IpcMain, 'handle'>,
  deps: Dependencies,
) {
  const envelope = async (action: () => unknown) => {
    try {
      return { ok: true, result: await action() };
    } catch {
      return {
        ok: false,
        // i18n-ignore (private IPC diagnostic; not rendered by this opt-in lane)
        error: { code: 'NOTE_SAVE_UNAVAILABLE', message: 'Bound note save unavailable' },
      };
    }
  };
  ipc.handle(channels.CAPTURE, (event, raw: unknown) =>
    envelope(() => {
      if (occupied) noteSaveUnavailable();
      const claim = { retired: false };
      occupied = claim;
      let s: Slot | undefined;
      try {
        const op = parseNoteSaveIdentity(raw),
          binding = getStrictBackendBindingForWebContents(event.sender);
        if (
          !binding ||
          event.senderFrame !== binding.frame ||
          binding.backendId !== op.scope.backendId ||
          Date.now() >= Date.parse(op.expiresAt)
        )
          noteSaveUnavailable();
        const generation = deps.credentialGeneration(op.scope.backendId),
          client = deps.readBackend(op.scope.backendId);
        const connection = client?.getRepositoryConnection();
        if (!client || !connection || occupied !== claim || claim.retired) noteSaveUnavailable();
        s = {
          id: randomUUID(),
          event,
          op,
          binding,
          client,
          connection,
          generation,
          deps,
          retired: false,
          unknown: false,
          commit: false,
          status: false,
          receiptCalls: 0,
          lexicalCalls: 0,
          sourceEntered: false,
          stops: [],
        };
        occupied = s;
        const captured = s;
        // A registration may install then throw without returning its disposer.
        // Keep the slot charged unless each returned subscription is owned.
        s.unknown = true;
        s.stops.push(onStrictBackendBindingRetired(event.sender, () => retire(captured)));
        s.stops.push(
          client.onRepositoryConnectionEvent((e) => {
            if (
              (e.type === 'closed' && e.incarnation === connection.incarnation) ||
              (e.type === 'identity-retired' && e.connection === connection)
            )
              retire(captured);
          }),
        );
        const destroyed = () => {
          void release(captured).catch(() => {});
        };
        event.sender.once('destroyed', destroyed);
        s.stops.push(() => event.sender.removeListener('destroyed', destroyed));
        s.unknown = false;
        if (!current(s)) noteSaveUnavailable();
        return { id: s.id };
      } catch (e) {
        if (s) {
          void release(s).catch(() => {});
        } else if (occupied === claim) occupied = undefined;
        throw e;
      }
    }),
  );
  ipc.handle(channels.REQUEST, (event, raw: unknown) =>
    envelope(() => {
      const { slot: s, command: c } = addressed(event, raw, true);
      if (!c) noteSaveUnavailable();
      if (s.pending || s.release || !current(s)) noteSaveUnavailable();
      let yes!: (v: NoteSaveConnectionResult) => void, no!: (e: unknown) => void;
      const pending = new Promise<NoteSaveConnectionResult>((resolve, reject) => {
        yes = resolve;
        no = reject;
      });
      s.pending = pending;
      void (async () => {
        let entered = false;
        try {
          const request = wire(s, c);
          copyNoteSaveData(request, 16384, true);
          if (!current(s)) noteSaveUnavailable();
          entered = true;
          const rawResult = await s.client.requestOnCapturedConnection(
            s.connection,
            request.method,
            request.params,
          );
          const value = copyNoteSaveData(
            rawResult,
            c.kind === 'commit' || c.kind === 'status' ? 4096 : 8192,
          );
          validate(s, c, value); // Preserve actual own ACK before liveness checks.
          yes({ id: s.id, current: current(s), settlement: { status: 'fulfilled', value } });
        } catch (e) {
          // Only a structured daemon error proves known local request completion.
          const rpcCode =
            e instanceof Error && 'code' in e && typeof e.code === 'number' ? e.code : undefined;
          if (entered && rpcCode === undefined) {
            s.unknown = true;
            retire(s);
          }
          if (entered && rpcCode !== undefined)
            yes({
              id: s.id,
              current: current(s),
              settlement: {
                status: 'rejected',
                // i18n-ignore (private IPC diagnostic; not rendered by this opt-in lane)
                error: { code: 'RPC_ERROR', message: 'Note request rejected', rpcCode },
              },
            });
          else no(e);
        } finally {
          if (s.pending === pending) s.pending = undefined;
        }
      })();
      return pending;
    }),
  );
  ipc.handle(channels.RELEASE, (event, raw: unknown) =>
    envelope(() => {
      return release(addressed(event, raw).slot);
    }),
  );
  return {
    retireBackend(id: string) {
      const s = occupied as Slot | undefined;
      if (s?.op?.scope.backendId === id) retire(s);
      else if (occupied && !s?.op) Object.assign(occupied, { retired: true });
    },
    dispose() {
      const s = occupied as Slot | undefined;
      if (s?.op) {
        retire(s);
        void release(s).catch(() => {});
      } else if (occupied) Object.assign(occupied, { retired: true });
    },
  };
}
