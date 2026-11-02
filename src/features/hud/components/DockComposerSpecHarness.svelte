<script lang="ts">
  import { onMount } from 'svelte';
  import '$lib/styles/dock-tokens.css';
  import type { ContextItem } from '$lib/components/chat/input/context-api';
  import type { DockInsertionPart, EditorScreenReference } from '$shared/dock-evidence';
  import { store } from '$store/renderer/store';
  import { selectDockConversationComposer } from '$store/renderer/slices/dock-conversation/dock-conversation-selectors';
  import { openDockConversationRequested } from '$store/renderer/slices/dock-conversation/dock-conversation-slice';
  import DockConversationPanel from './DockConversationPanel.svelte';
  import DockConversationSurface from './DockConversationSurface.svelte';
  import DockConversationComposer from './DockConversationComposer.svelte';
  import type {
    DockComposerAttachment,
    DockComposerMediaBinding,
  } from './dock-composer-media-presentation';
  import { labels, fixtureImage } from './dock-composer-media.preview.svelte';
  import { conversationMessages } from './dock-conversation.preview-fixtures';
  import {
    setupConversationWire,
    conversationWireWorkspace,
  } from './dock-conversation-wire.preview-fixtures';

  /** The six owner-spec screens: idle, captured, annotate hovered, annotating, dictating, recording. */
  let {
    screen = 1,
    width = 420,
    height = 560,
  }: { screen?: 1 | 2 | 3 | 4 | 5 | 6; width?: number; height?: number } = $props();

  const composer$ = selectDockConversationComposer();
  let ready = $state(false);
  let draft = $state('');
  let contextItems = $state<ContextItem[]>([]);
  // Interim speech anchors at the caret when it starts, as in production.
  let interimStarted = $state(false);
  let actions = $state<string[]>([]);
  const record = (action: string) => (actions = [...actions, action]);

  const marked = $derived(screen >= 4);
  const references: EditorScreenReference[] = [
    { id: 'mark-one', number: 1, label: 'Save' },
    { id: 'mark-two', number: 2, label: 'Cancel' },
  ];
  // i18n-ignore (synthetic owner-spec transcript; production text is the person's own)
  const drafts: Record<number, string> = {
    4: 'Closer, but this [[mark:1]] still has the old shadow, and this one [[mark:2]]',
    5: 'Closer, but this [[mark:1]] still has the old shadow, and this one [[mark:2]]',
    6: 'Closer, but this [[mark:1]] still has the old shadow, and this one [[mark:2]] drops its hover state.',
  };
  // i18n-ignore (synthetic interim speech)
  const interim: DockInsertionPart[] = [{ kind: 'text', text: ' drops its hover' }];
  const attachments = $derived.by((): DockComposerAttachment[] => {
    if (screen === 1) return [];
    const image: DockComposerAttachment = {
      kind: 'image',
      owner: 'evidence',
      id: 'image-one',
      url: fixtureImage(marked),
      markCount: marked ? 2 : 0,
    };
    if (screen !== 6) return [image];
    return [
      image,
      { kind: 'clip', owner: 'evidence', id: 'clip-one', duration: '0:14', recording: true },
    ];
  });
  const media = $derived<DockComposerMediaBinding>({
    labels,
    state: {
      captureRevision: 0,
      annotationActive: screen === 4,
      tool: marked ? 'box' : 'pick',
      toolUsed: marked,
      recording: screen === 6,
      recordingTime: '0:14',
      dictating: screen === 5,
      dictationTime: '0:09',
      // Deterministic synthetic levels; production samples come from the microphone.
      inputLevels:
        screen === 5
          ? Array.from({ length: 28 }, (_, i) => 0.15 + 0.85 * Math.abs(Math.sin(i * 0.9)))
          : [],
    },
    // i18n-ignore (synthetic placeholder copy mirrors the localized production strings)
    placeholder:
      screen === 1
        ? 'Message Design companion'
        : screen === 4
          ? undefined
          : 'Say what should change',
    attachments,
    onCapture: () => record('capture'),
    onRecordToggle: () => record('record'),
    onAnnotationToggle: () => record('annotate'),
    onToolSelect: (tool) => record(`tool:${tool}`),
    onDictationToggle: () => record('dictate'),
    onDictationHoldStart: () => record('hold-start'),
    onDictationHoldEnd: () => record('hold-end'),
    onMarkUp: (id) => record(`markup:${id}`),
    onRemove: (id) => record(`remove:${id}`),
  });
  const mediaStatus = $derived(
    screen === 4
      ? { kind: 'annotating' as const, label: labels.annotating }
      : screen === 5
        ? { kind: 'listening' as const, label: labels.listening }
        : screen === 6
          ? { kind: 'recording' as const, label: labels.recording }
          : undefined,
  );

  onMount(() => {
    const root = document.documentElement;
    const hadDark = root.classList.contains('dark');
    const hadLight = root.classList.contains('light');
    root.classList.add('dark');
    root.classList.remove('light');
    const fixture = setupConversationWire(() => {});
    store.dispatch(openDockConversationRequested(conversationWireWorkspace));
    draft = drafts[screen] ?? '';
    // Production evidence tiles are context items; they make Send live.
    contextItems = attachments.map((item) => ({
      id: item.id,
      type: 'file' as const,
      label: item.kind,
      attachmentId: item.id,
    }));
    ready = true;
    return () => {
      fixture.dispose();
      root.classList.toggle('dark', hadDark);
      root.classList.toggle('light', hadLight);
    };
  });
</script>

<div data-actions={JSON.stringify(actions)}>
  <div
    data-testid="composer-spec"
    data-screen={screen}
    style:width={`${width}px`}
    style:height={`${height}px`}
    data-dock-surface="notch"
    data-expanded
  >
    {#if ready && $composer$.workspace && $composer$.agentId}
      {@const workspace = $composer$.workspace}
      {@const agentId = $composer$.agentId}
      <DockConversationSurface workspaceId={conversationWireWorkspace} resizable={false}>
        <DockConversationPanel
          conversationKey={agentId}
          {agentId}
          agents={[{ id: agentId, name: 'Design companion', isMain: true }]}
          workspaceTitle="Make workspace navigation feel effortless"
          messages={conversationMessages.slice(0, 2)}
          {draft}
          {mediaStatus}
          onDraftChange={(value) => (draft = value)}
          onSend={() => record('send')}
          onSelectAgent={() => {}}
          onBack={() => {}}
          onOpenWorkspace={() => {}}
          onRetryLoad={() => {}}
          onRetrySend={() => {}}
        >
          {#snippet composer()}
            <DockConversationComposer
              {workspace}
              {agentId}
              value={draft}
              {contextItems}
              selectedModel={$composer$.selectedModel}
              providerId={$composer$.providerId}
              {media}
              screenReferences={marked ? references : undefined}
              screenInterim={screen === 5 && interimStarted ? interim : undefined}
              onValueChange={(text) => (draft = text)}
              onContextItemsChange={(items) => (contextItems = items)}
              onSubmit={() => record('send')}
              onStop={() => {}}
            />
          {/snippet}
        </DockConversationPanel>
      </DockConversationSurface>
    {/if}
  </div>
  <!-- i18n-ignore (fixture control) -->
  <button onclick={() => (interimStarted = true)}>Start interim speech</button>
</div>
