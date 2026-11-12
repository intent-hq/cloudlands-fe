import type { ChatDraftManager } from '../chat-panel-draft.svelte';
import { defaultDockMediaEdit, type DockMediaSource } from '$shared/dock-media-edit';
import { createChatDraftBroker } from '$shared/chat-draft-broker';
import type { SharedDraft } from '$shared/types/chat-draft-sync';
import { createDraftSyncConnection } from '../chat-draft-sync';
import { createChatDraftStoreDriver } from './mocks/chat-draft-store-driver';
import { createChatDraftFixture } from '../../../../test/fixtures/chat-drafts';
import {
  setupConversationWire,
  readComposerDraftSnapshot,
  type ConversationWireCall,
  conversationWireWorkspace,
} from '$features/hud/components/dock-conversation-wire.preview-fixtures';
import { store } from '$store/renderer/store';
import {
  chatDraftOwnerOpened,
  chatDraftSaveScheduled,
  chatDraftSaveFlushRequested,
  chatDraftClearRequested,
} from '$store/renderer/slices/chat-drafts/chat-drafts-slice';
import {
  openDockConversationRequested,
  closeDockConversationRequested,
} from '$store/renderer/slices/dock-conversation/dock-conversation-slice';

export function setupSharedDraftFixture() {
  const drafts = createChatDraftFixture().client;
  const provenance = JSON.stringify(['local', 'shared-fixture-principal']);
  let contextGeneration = 0;
  const context = () => JSON.stringify([provenance, contextGeneration]);
  const listeners = new Set<(draft: SharedDraft) => void>();
  const failures: string[] = [];
  const transactions: unknown[] = [];
  let releaseWrites: (() => void) | undefined;
  let writesReady: Promise<void> = Promise.resolve();
  let beforeHandoff: string | null = null;
  const broker = createChatDraftBroker(
    provenance,
    {
      get: (...args) => drafts.get(...args),
      set: async (...args) => {
        await writesReady;
        return drafts.set(...args);
      },
      clear: async (...args) => {
        await writesReady;
        return drafts.clear(...args);
      },
    },
    (value) => {
      transactions.push({ changed: value });
      for (const listener of listeners) listener(value);
    },
    () => true,
    (error) => failures.push(error instanceof Error ? error.message : String(error)),
  );
  const connect = () => {
    const owner = {};
    return createDraftSyncConnection(
      {
        request: (request) => broker.request(request, { owner, current: () => true }),
        subscribe: (listener) => {
          listeners.add(listener);
          return () => {
            listeners.delete(listener);
          };
        },
      },
      () => provenance,
      context,
    );
  };
  let holdMain = false;
  const heldMain: SharedDraft[] = [];
  const mainOwner = {};
  let releaseMain = () => {};
  const main = createDraftSyncConnection(
    {
      request: (request) => broker.request(request, { owner: mainOwner, current: () => true }),
      subscribe: (listener) => {
        const receive = (value: SharedDraft) => {
          if (holdMain) heldMain.push(value);
          else listener(value);
        };
        listeners.add(receive);
        releaseMain = () => {
          holdMain = false;
          for (const value of heldMain.splice(0)) listener(value);
        };
        return () => {
          listeners.delete(receive);
        };
      },
    },
    () => provenance,
    context,
  );
  const dock = connect();
  const calls: ConversationWireCall[] = [];
  const wire = setupConversationWire(
    (call) => {
      calls.push(call);
    },
    { draftsClient: drafts, draftSync: dock },
  );
  const driver = createChatDraftStoreDriver(drafts, main);
  store.dispatch(openDockConversationRequested(conversationWireWorkspace));
  return {
    workspaceId: conversationWireWorkspace,
    agentId: 'wire-main',
    driver,
    holdMain() {
      holdMain = true;
    },
    releaseMain() {
      releaseMain();
    },
    async saved() {
      return drafts.get(conversationWireWorkspace, 'wire-main');
    },
    holdPersistence() {
      writesReady = new Promise<void>((resolve) => {
        releaseWrites = resolve;
      });
    },
    beforeHandoff: () => beforeHandoff,
    async handoff() {
      beforeHandoff = (await drafts.get(conversationWireWorkspace, 'wire-main'))?.text ?? '';
      releaseWrites?.();
      releaseWrites = undefined;
      await dock.flush(conversationWireWorkspace, 'wire-main');
    },
    closeDock() {
      store.dispatch(closeDockConversationRequested());
    },
    openDock() {
      store.dispatch(openDockConversationRequested(conversationWireWorkspace));
    },
    retireContext() {
      contextGeneration += 1;
    },
    async queuedAuthorityProof() {
      let epoch = 0;
      let release: (() => void) | undefined;
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      const methods: string[] = [];
      const owner = {};
      const connection = createDraftSyncConnection(
        {
          request: async (request) => {
            methods.push(request.kind);
            await held;
            return broker.request(request, { owner, current: () => true });
          },
          subscribe: () => () => {},
        },
        () => provenance,
        () => String(epoch),
      );
      const pending = connection.edit('retired-renderer', conversationWireWorkspace, 'wire-main', {
        text: 'must never replace draft',
        attachments: [],
      });
      epoch += 2; // Same principal after A -> B -> A, a different action lifetime.
      release?.();
      const rejected = await pending.then(
        () => false,
        () => true,
      );
      connection.dispose();
      return { rejected, methods };
    },
    failures: () => [...failures],
    transactions: () => [...transactions],
    delivery: readComposerDraftSnapshot,
    sends: () =>
      calls.filter(
        (call) => call.method === 'agent.sendMessage' || call.method === 'agent.queueMessage',
      ),
    settleSend: (accepted: boolean) => wire.settle(accepted),
    loseSend: () => wire.loseSendResponse(),
    async changeForeignPair() {
      await main.edit('foreign-agent-owner', conversationWireWorkspace, 'other-agent', {
        text: 'Other agent draft',
        attachments: [],
      });
      await main.edit('foreign-workspace-owner', 'other-workspace', 'wire-main', {
        text: 'Other workspace draft',
        attachments: [],
      });
    },
    async seedScreen() {
      const text = 'Review [[mark:1]] in this screenshot';
      const attachment = {
        id: 'shared-image',
        type: 'file',
        label: 'screen.png',
        imageData:
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6XZkAAAAASUVORK5CYII=',
        imageMimeType: 'image/png',
        screen: {
          kind: 'image',
          image: {
            id: 'screen-one',
            width: 100,
            height: 100,
            displayScale: 1,
            capturedAt: '2026-11-12T00:00:00Z',
            source: 'capture',
          },
          marks: [
            {
              index: 0,
              mark: {
                id: 'mark-one',
                imageId: 'screen-one',
                tool: 'box',
                geometry: { kind: 'rect', x: 10, y: 10, w: 20, h: 20 },
                bounds: { x: 10, y: 10, w: 20, h: 20 },
                element: null,
                createdAt: 1,
              },
            },
          ],
        },
      };
      await dock.edit('fixture-screen-owner', conversationWireWorkspace, 'wire-main', {
        text,
        attachments: [attachment],
      });
      await dock.flush(conversationWireWorkspace, 'wire-main');
      return attachment.screen;
    },
    async removeRecording(clear: boolean) {
      if (clear) await dock.clear(conversationWireWorkspace, 'wire-main');
      else {
        const current = await dock.read(conversationWireWorkspace, 'wire-main');
        await dock.edit('dock-fixture', conversationWireWorkspace, 'wire-main', {
          text: current.snapshot.text,
          attachments: [],
        });
      }
      await dock.flush(conversationWireWorkspace, 'wire-main');
    },
    async seedRecording() {
      const source: DockMediaSource = {
        id: 'shared-recording-source',
        revision: 0,
        kind: 'recording',
        attachmentId: 'shared-recording-file',
        path: '.intent/attachments/shared-recording.mp4',
        durationMs: 5000,
        width: 640,
        height: 360,
        audio: 'available',
        visuals: 'clean',
        batches: [],
        capturedMarks: [],
      };
      const media = {
        source,
        saved: { ...defaultDockMediaEdit(source, [], null), voice: 'audio' as const },
        transcript: null,
      };
      const attachment = {
        id: 'shared-recording',
        type: 'file',
        label: 'clip-shared-recording.mp4',
        attachmentId: source.attachmentId,
        path: source.path,
        attachmentMimeType: 'video/mp4',
        screen: {
          kind: 'clip',
          clip: {
            id: 'shared-clip',
            startedAt: 0,
            durationMs: source.durationMs,
            hasMicAudio: true,
            path: source.path,
            media,
          },
        },
      };
      await dock.edit('fixture-recording-owner', conversationWireWorkspace, 'wire-main', {
        text: 'Review this recording',
        attachments: [attachment],
      });
      await dock.flush(conversationWireWorkspace, 'wire-main');
      return attachment;
    },
    async peerRecordingText(text: string) {
      const current = await dock.read(conversationWireWorkspace, 'wire-main');
      await dock.edit('fixture-peer-typing', conversationWireWorkspace, 'wire-main', {
        ...current.snapshot,
        text,
      });
    },
    releasePersistence() {
      releaseWrites?.();
      releaseWrites = undefined;
    },
    async queuedClearProof(retire: boolean) {
      const isolatedDrafts = createChatDraftFixture().client;
      const notifications = new Set<(value: SharedDraft) => void>();
      const changes: string[] = [];
      const isolated = createChatDraftBroker(provenance, isolatedDrafts, (value) => {
        changes.push(value.snapshot.text);
        for (const notify of notifications) notify(value);
      });
      let epoch = 0;
      let releaseFlush!: () => void;
      let enteredFlush!: () => void;
      let completedClear!: () => void;
      const flushGate = new Promise<void>((resolve) => {
        releaseFlush = resolve;
      });
      const flushEntered = new Promise<void>((resolve) => {
        enteredFlush = resolve;
      });
      const clearCompleted = new Promise<void>((resolve) => {
        completedClear = resolve;
      });
      const owner = {};
      const methods: string[] = [];
      const local = createDraftSyncConnection(
        {
          request: async (request) => {
            methods.push(request.kind);
            if (request.kind === 'flush') {
              enteredFlush();
              await flushGate;
            }
            try {
              return await isolated.request(request, { owner, current: () => true });
            } finally {
              if (request.kind === 'clear') completedClear();
            }
          },
          subscribe: (notify) => {
            notifications.add(notify);
            return () => {
              notifications.delete(notify);
            };
          },
        },
        () => provenance,
        () => String(epoch),
      );
      const peerOwner = {};
      const peer = createDraftSyncConnection(
        {
          request: (request) =>
            isolated.request(request, { owner: peerOwner, current: () => true }),
          subscribe: (notify) => {
            notifications.add(notify);
            return () => {
              notifications.delete(notify);
            };
          },
        },
        () => provenance,
      );
      const isolatedDriver = createChatDraftStoreDriver(isolatedDrafts, local);
      const ws = 'queued-clear-workspace';
      const agent = 'queued-clear-agent';
      try {
        await local.read(ws, agent);
        isolatedDriver.dispatch(chatDraftOwnerOpened('old-editor'));
        isolatedDriver.dispatch(
          chatDraftSaveScheduled('old-editor', 'old-save', {
            authority: '0',
            workspaceId: ws,
            agentId: agent,
            text: 'old draft',
            attachments: [],
            rollback: null,
          }),
        );
        isolatedDriver.dispatch(chatDraftSaveFlushRequested('old-editor'));
        await flushEntered;
        isolatedDriver.dispatch(chatDraftClearRequested(ws, agent));
        // The actual client captures the old predecessor now. A peer write is
        // allowed while the renderer's older durability receipt is still held.
        await peer.read(ws, agent);
        await peer.edit('peer-editor', ws, agent, {
          text: 'peer typed after clear request',
          attachments: [],
        });
        await peer.flush(ws, agent);
        if (retire) epoch += 2;
        releaseFlush();
        await clearCompleted;
        const canonical = await peer.read(ws, agent);
        const beforeInvalid = methods.length;
        isolatedDriver.dispatch(
          chatDraftSaveScheduled('old-editor', 'wrong-authority', {
            authority: 'retired-context',
            workspaceId: ws,
            agentId: agent,
            text: 'invalid overwrite',
            attachments: [],
            rollback: null,
          }),
        );
        await Promise.resolve();
        const persisted = await isolatedDrafts.get(ws, agent);
        isolatedDriver.stop();
        peer.dispose();
        isolated.dispose();
        // A fresh broker and renderer must restore durable state, not the old
        // connection's in-memory snapshot after the queued clear settles.
        const reopenedBroker = createChatDraftBroker(provenance, isolatedDrafts, () => {});
        const reopenedOwner = {};
        const reopened = createDraftSyncConnection(
          {
            request: (request) =>
              reopenedBroker.request(request, { owner: reopenedOwner, current: () => true }),
            subscribe: () => () => {},
          },
          () => provenance,
        );
        let restored: string;
        try {
          restored = (await reopened.read(ws, agent)).snapshot.text;
        } finally {
          reopened.dispose();
          reopenedBroker.dispose();
        }
        return {
          text: canonical.snapshot.text,
          persisted: persisted?.text,
          restored,
          invalidPublished: methods.length !== beforeInvalid,
          changes,
        };
      } finally {
        releaseFlush();
        isolatedDriver.stop();
        peer.dispose();
        isolated.dispose();
      }
    },
    async lifecycleProof() {
      let release!: (value: null) => void;
      const held = new Promise<null>((resolve) => {
        release = resolve;
      });
      let retired = false;
      const records: string[] = [];
      const isolated = createChatDraftBroker(
        provenance,
        {
          get: (workspaceId) => (workspaceId === 'bootstrap' ? Promise.resolve(null) : held),
          set: async (_ws, _agent, text) => {
            records.push(text);
          },
          clear: async () => {
            records.push('<clear>');
          },
        },
        () => {},
      );
      const owner = {};
      const address = { provenance, workspaceId: 'lifetime', agentId: 'lifetime-agent' };
      const bootstrap = (
        await isolated.request(
          { ...address, workspaceId: 'bootstrap', kind: 'read' },
          { owner, current: () => true },
        )
      ).draft;
      const pending = isolated.request(
        {
          ...address,
          kind: 'edit',
          lifetime: bootstrap.lifetime,
          revision: 0,
          origin: 'retired-writer',
          sequence: 1,
          snapshot: { text: 'must never be admitted', attachments: [] },
        },
        { owner, current: () => !retired },
      );
      retired = true;
      release(null);
      const retiredAdmission = await pending.then(
        () => false,
        () => true,
      );
      const admission = { owner: {}, current: () => true };
      const base = (await isolated.request({ ...address, kind: 'read' }, admission)).draft;
      await isolated.request(
        {
          ...address,
          kind: 'edit',
          lifetime: base.lifetime,
          revision: base.revision,
          origin: 'closing-editor',
          sequence: 1,
          snapshot: { text: 'survives closed origin', attachments: [] },
        },
        admission,
      );
      // No renderer flush: the real broker owns this accepted edit's durability timer.
      const acceptedOwner = admission.owner;
      admission.current = () => false;
      let clearBarrier = false;
      const inspect = async () => {
        if (records.includes('survives closed origin') && !clearBarrier) {
          const liveAdmission = { owner: acceptedOwner, current: () => true };
          const saved = (await isolated.request({ ...address, kind: 'read' }, liveAdmission)).draft;
          const first = await isolated.request(
            {
              ...address,
              kind: 'clear',
              lifetime: saved.lifetime,
              revision: saved.revision,
              origin: 'closing-editor',
            },
            liveAdmission,
          );
          const second = await isolated.request(
            {
              ...address,
              kind: 'clear',
              lifetime: saved.lifetime,
              revision: first.draft.revision,
              origin: 'closing-editor',
            },
            liveAdmission,
          );
          const stale = await isolated.request(
            {
              ...address,
              kind: 'edit',
              lifetime: saved.lifetime,
              revision: first.draft.revision,
              origin: 'closing-editor',
              sequence: 99,
              snapshot: { text: 'stale resurrection', attachments: [] },
            },
            liveAdmission,
          );
          clearBarrier = second.draft.revision > first.draft.revision && !stale.accepted;
        }
        const foreign = await isolated
          .request(
            { ...address, provenance: 'foreign-principal', kind: 'read' },
            { owner: {}, current: () => true },
          )
          .then(
            () => false,
            () => true,
          );
        return { retiredAdmission, records: [...records], clearBarrier, foreign };
      };
      return { inspect, dispose: () => isolated.dispose() };
    },
    dispose() {
      releaseWrites?.();
      driver.stop();
      wire.dispose();
      broker.dispose();
    },
  };
}
export type SharedDraftFixture = ReturnType<typeof setupSharedDraftFixture>;

declare global {
  interface Window {
    __sharedDraftFixture?: SharedDraftFixture;
    __sharedDraftManager?: ChatDraftManager;
  }
}
