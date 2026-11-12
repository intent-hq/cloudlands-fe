<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import SimpleRichInput from '../input/SimpleRichInput.svelte';
  import { createChatDraftManager } from '../chat-panel-draft.svelte';
  import ChatRecordingAttachments from '../ChatRecordingAttachments.svelte';
  import { createChatRecordingEditor } from '../chat-recording-editor.svelte';
  import { chatRecordingEvidence } from '../chat-recording-attachments';
  import type { ChatDraftStoreDriver } from './mocks/chat-draft-store-driver';
  import type { ContextItem } from '../input/context-api';
  import { chatDraftClearRequested } from '$store/renderer/slices/chat-drafts/chat-drafts-slice';
  let {
    driver,
    workspaceId,
    agentId,
    outputReady = true,
  }: {
    driver: ChatDraftStoreDriver;
    workspaceId: string;
    agentId: string;
    outputReady?: boolean;
  } = $props();
  let value = $state('');
  let items = $state<ContextItem[]>([]);
  let input = $state<SimpleRichInput>();
  const manager = createChatDraftManager({
    store: untrack(() => driver.port),
    workspaceId: () => workspaceId,
    agentId: () => agentId,
    inputValue: () => value,
    setInputValue: (text) => {
      value = text;
    },
    contextItems: () => items,
    setContextItems: (next) => {
      items = next;
    },
    applyEditorContent: (text) => {
      void input?.setContent(text);
    },
  });
  const capture = $derived(manager.captureDraft());
  const recordingIds = $derived(
    chatRecordingEvidence(capture)?.clips.flatMap((clip) =>
      clip.contextItemId ? [clip.contextItemId] : [],
    ) ?? [],
  );
  onMount(() => {
    window.__sharedDraftManager = manager;
    return () => {
      delete window.__sharedDraftManager;
    };
  });
  function clear() {
    manager.invalidatePendingRestore();
    value = '';
    items = [];
    input?.clear();
    driver.dispatch(chatDraftClearRequested(workspaceId, agentId));
  }
</script>

<div data-testid="shared-main" data-value={value} data-items={JSON.stringify(items)}>
  <SimpleRichInput
    workspace={null}
    bind:this={input}
    bind:value
    bind:contextItems={items}
    {agentId}
    inputLocked={manager.gateActive}
    customContextAttachmentIds={recordingIds}
  >
    {#snippet renderCustomAttachments()}
      <ChatRecordingAttachments
        {capture}
        drafts={manager}
        disabled={manager.gateActive}
        onRemove={(id) => input?.removeAttachment(id) ?? false}
        controllerFactory={(options) =>
          createChatRecordingEditor({
            ...options,
            prepareOutput: async (clicked, _media, drafts) => {
              // The browser cannot load native exporters; retain the real draft flush boundary.
              return { ready: (await drafts.flushDraft(clicked)) && outputReady, version: 2 };
            },
          })}
      />
    {/snippet}
  </SimpleRichInput>
  <button onclick={clear}>Clear main draft</button>
  <button
    onclick={() => {
      items = [];
    }}>Remove main attachments</button
  >
  <button
    onclick={() => {
      items = [
        ...items,
        {
          id: 'staged-file',
          type: 'file',
          label: 'pending.txt',
          sourcePath: '/synthetic/pending.txt',
          placementStatus: 'failed',
        },
      ];
    }}>Stage main file</button
  >
  <button
    onclick={() => {
      items = items.map((item) =>
        item.id === 'shared-image'
          ? { ...item, attachmentId: 'replacement-id', path: 'attachments/replacement.png' }
          : item,
      );
    }}>Replace screenshot source</button
  >
</div>
