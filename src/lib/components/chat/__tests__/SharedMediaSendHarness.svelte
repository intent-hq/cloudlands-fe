<script lang="ts">
  import { onMount } from 'svelte';
  import { store } from '$store/renderer/store';
  import { getPrincipalActionContext } from '$store/renderer/slices/principal/principal-context';
  import {
    setupConversationWire,
    conversationWireWorkspace as workspaceId,
    type ConversationWireCall,
  } from '$features/hud/components/dock-conversation-wire.preview-fixtures';
  import { openDockConversationRequested } from '$store/renderer/slices/dock-conversation/dock-conversation-slice';
  import { setAgentStreaming } from '$store/renderer/slices/agent-session/agent-session-slice';
  import {
    submitPreparedChatMessage,
    type PreparedChatDraftCapture,
  } from '$features/agent/prepare-chat-submission';
  import { selectWorkspaceParticipationContext } from '$store/renderer/slices/workspace/workspace-selectors';
  import { serializeDraftAttachments } from '../chat-draft-attachments';
  import { planChatSend } from '../composer-submission';
  import {
    probeUnavailableMediaAdapter,
    persistSyntheticDraft,
    invokeFixtureBridge,
  } from './shared-media-send.preview-fixtures';
  import {
    defaultDockMediaEdit,
    type DockMediaSource,
    type DockSavedMedia,
  } from '$shared/dock-media-edit';
  import { CHAT_MEDIA_CHANNELS as C } from '$shared/chat-media-ipc';
  import { IPC_CHANNELS } from '$shared/ipc-registry';
  import type { ContextItem } from '../input/context-api';
  let calls = $state<ConversationWireCall[]>([]),
    result = $state('idle'),
    ready = $state(false);
  let native = $state<string[]>([]),
    exportRequest = $state<unknown>(null),
    preparedPng = $state('');
  let mode = $state('direct'),
    draftText = $state('Review [[mark:1]] in edited captures');
  let fixture: ReturnType<typeof setupConversationWire>;
  let controller: AbortController | null = null;
  let release: (() => void) | null = null;
  let sourcePng = '';
  let platformProbe = $state<string[]>([]);
  let syntheticBridge: NonNullable<Window['electronAPI']>;
  const agentId = 'wire-main';
  function descriptors() {
    const source: DockMediaSource = {
      id: 'screenshot-source',
      revision: 0,
      kind: 'screenshot',
      attachmentId: 'raw-image',
      path: '.intent/attachments/raw.png',
      durationMs: 0,
      width: 64,
      height: 64,
      audio: 'none',
      batches: [],
      visuals: 'clean',
      capturedMarks: [],
    };
    const media: DockSavedMedia = {
      source,
      originalSource: source,
      saved: {
        ...defaultDockMediaEdit(source, [], null),
        marks: [
          {
            id: 'saved-mark',
            atMs: 0,
            batchId: 'saved-batch',
            source: 'editor',
            kind: 'box',
            included: true,
            geometry: { kind: 'rect', x: 24, y: 24, w: 8, h: 8 },
            label: 'Inspect this control',
            note: 'Saved screenshot annotation',
            context: { selector: '#synthetic-control', text: 'Synthetic control', url: null },
          },
        ],
        crop: { x: 8, y: 8, w: 32, h: 32 },
        blurRegions: [{ id: 'blur', x: 8, y: 8, w: 12, h: 12 }],
      },
      transcript: null,
    };
    const clipSource: DockMediaSource = {
      ...source,
      id: 'clip-source',
      kind: 'recording',
      attachmentId: 'raw-clip',
      path: '.intent/attachments/raw.mp4',
      durationMs: 1000,
      audio: 'available',
    };
    const clip: DockSavedMedia = {
      source: clipSource,
      saved: {
        ...defaultDockMediaEdit(clipSource, [], null),
        trim: { startMs: 100, endMs: 900 },
        cuts: [{ startMs: 400, endMs: 500 }],
        voice: 'off',
      },
      transcript: null,
    };
    const items: ContextItem[] = [
      {
        id: 'image-item',
        type: 'file',
        label: 'image.png',
        attachmentId: source.attachmentId,
        path: source.path,
        imageMimeType: 'image/png',
      },
      {
        id: 'clip-item',
        type: 'file',
        label: 'video.mp4',
        attachmentId: clipSource.attachmentId,
        path: clipSource.path,
        attachmentMimeType: 'video/mp4',
      },
    ];
    const screen = {
      'image-item': {
        kind: 'image',
        image: {
          id: 'image-one',
          width: 64,
          height: 64,
          displayScale: 1,
          capturedAt: '2026-11-12T00:00:00Z',
          source: 'capture',
          media,
        },
        marks: [
          {
            index: 0,
            mark: {
              id: 'saved-mark',
              imageId: 'image-one',
              tool: 'box',
              geometry: { kind: 'rect', x: 24, y: 24, w: 8, h: 8 },
              bounds: { x: 24, y: 24, w: 8, h: 8 },
              element: null,
              createdAt: 1,
            },
          },
        ],
      },
      'clip-item': {
        kind: 'clip',
        clip: {
          id: 'clip-one',
          startedAt: 0,
          durationMs: 1000,
          hasMicAudio: true,
          path: clipSource.path,
          media: clip,
        },
      },
    };
    if (mode === 'invalid') media.saved!.sourceRevision = 99;
    return { items, attachments: serializeDraftAttachments(items, screen), clip };
  }
  async function send() {
    const { items, attachments, clip } = descriptors();
    if (mode === 'missing-preload' || mode === 'browser-mock')
      platformProbe = await probeUnavailableMediaAdapter(mode, clip);
    const capture: PreparedChatDraftCapture = {
      authority: getPrincipalActionContext(store.state)!,
      ownerId: 'synthetic-main-editor',
      workspaceId,
      agentId,
      text: draftText,
      attachments,
      generation: 1,
      attachmentEpoch: 0,
    };
    const plan = planChatSend('composer', draftText, () => ({
      contextItems: items,
      checkedPanels: [],
      checkedSelections: [],
      pickedMentions: { picked_mentions: { agentIds: ['mentioned-agent'] } },
    }));
    controller = new AbortController();
    result = 'preparing';
    const admitted = await submitPreparedChatMessage({
      capture,
      items,
      payload: { wsId: workspaceId, text: draftText, ...plan.fields },
      signal: controller.signal,
      drafts: {
        isCurrentDraft: (value) => value.text === draftText,
        flushDraft: async (value) => {
          await persistSyntheticDraft(value);
          return value.text === draftText;
        },
      },
    });
    window.electronAPI = syntheticBridge;
    result = admitted ? 'admitted' : 'retained';
    if (admitted && draftText === capture.text) draftText = '';
  }
  onMount(() => {
    fixture = setupConversationWire((call) => {
      calls = [...calls, call];
    });
    const originalBridge = window.electronAPI!;
    const originalFetch = window.fetch;
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const g = canvas.getContext('2d')!;
    g.fillStyle = '#fff';
    g.fillRect(0, 0, 64, 64);
    g.fillStyle = '#000';
    g.fillRect(8, 8, 6, 6);
    sourcePng = canvas.toDataURL('image/png').split(',')[1];
    window.fetch = async (input, init) => {
      if (!String(input).startsWith('workspace-file:')) return originalFetch(input, init);
      if (mode === 'missing-preload') delete (window as { electronAPI?: unknown }).electronAPI;
      if (mode === 'browser-mock')
        window.electronAPI = {
          ...syntheticBridge,
          versions: { ...syntheticBridge.versions, electron: '0.0.0-browser' },
        };
      return new Response(Uint8Array.from(atob(sourcePng), (x) => x.charCodeAt(0)));
    };
    window.electronAPI = {
      ...originalBridge,
      // This controlled native boundary deliberately does not inherit the browser sentinel.
      versions: { ...originalBridge.versions, electron: 'synthetic-electron' },
      invoke: async (channel, payload: any) => {
        if (channel === C.BEGIN) {
          native = [...native, 'begin'];
          return mode === 'unavailable'
            ? { ok: false, error: 'unavailable' }
            : { ok: true, value: { sessionId: 'dd5853a7-9590-4e6a-ad87-013000012345' } };
        }
        if (channel === C.CLOSE) {
          native = [...native, 'close'];
          return { ok: true, value: true };
        }
        if (channel === C.CONTROL) {
          native = [...native, payload.control.action];
          if (payload.control.action === 'release') return { ok: true, value: undefined };
          exportRequest = structuredClone(payload.control.request);
          if (mode === 'retired')
            await new Promise<void>((resolve) => {
              release = resolve;
            });
          return {
            ok: true,
            value: {
              jobId: payload.control.request.jobId,
              video: {
                sourcePath: '/synthetic/prepared.mp4',
                mimeType: 'video/mp4',
                size: 17,
                durationMs: 700,
              },
              frames: [],
            },
          };
        }
        if (channel === IPC_CHANNELS.BACKEND.REQUEST && payload.method === 'file.placeAttachment') {
          const params = payload.params;
          if (params.sourcePath) {
            calls = [...calls, { method: 'file.placeAttachment', params: structuredClone(params) }];
            return {
              ok: true,
              result: {
                ok: true,
                attachmentId: 'prepared-video',
                path: '.intent/attachments/prepared.mp4',
                fileName: 'prepared.mp4',
                size: 17,
                mimeType: 'video/mp4',
                uploadedAt: '2026-11-12T00:00:00Z',
              },
            };
          }
          preparedPng = params.data;
        }
        return invokeFixtureBridge(originalBridge, channel, payload);
      },
    };
    syntheticBridge = window.electronAPI;
    const stop = store.getReadableState().subscribe(() => {
      ready = !!selectWorkspaceParticipationContext.select(store.state, workspaceId);
    });
    store.dispatch(openDockConversationRequested(workspaceId));
    return () => {
      controller?.abort();
      release?.();
      stop();
      window.fetch = originalFetch;
      window.electronAPI = syntheticBridge;
      fixture.dispose();
    };
  });
</script>

<div
  data-testid="shared-media-send"
  data-ready={ready}
  data-result={result}
  data-calls={JSON.stringify(calls)}
  data-native={JSON.stringify(native)}
  data-export={JSON.stringify(exportRequest)}
  data-png={preparedPng}
  data-platform-probe={JSON.stringify(platformProbe)}
>
  <select
    aria-label="Send scenario"
    bind:value={mode}
    onchange={() => store.dispatch(setAgentStreaming(agentId, mode === 'queued'))}
  >
    <option value="missing-preload">Missing preload</option><option value="browser-mock"
      >Browser mock</option
    >
    <option value="direct">Direct</option><option value="queued">Queued</option><option
      value="invalid">Invalid saved edit</option
    ><option value="unavailable">Unavailable export</option><option value="retired"
      >Retired during export</option
    >
  </select>
  <textarea aria-label="Draft" bind:value={draftText}></textarea>
  <button onclick={() => void send()}>Send prepared draft</button>
  <button
    onclick={() => {
      draftText = 'New typing survives';
      controller?.abort();
      release?.();
    }}>Type during preparation</button
  >
  <button onclick={() => fixture.settle()}>Acknowledge send</button>
</div>
