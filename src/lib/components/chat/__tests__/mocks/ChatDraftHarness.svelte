<script lang="ts">
  /**
   * Mounted harness wiring createChatDraftManager to a mock composer exactly
   * the way ChatPanel wires the real SimpleRichInput: value binding, deferred
   * editor hydration via setContent, the gate-driven input lock, and the
   * delayed ChatDraftLoadingGate indicator.
   */
  import type { DraftsClient } from '$lib/client/app-client';
  import { chatDraftClearRequested } from '$store/renderer/slices/chat-drafts/chat-drafts-slice';
  import ChatDraftLoadingGate from '../../ChatDraftLoadingGate.svelte';
  import { createChatDraftManager } from '../../chat-panel-draft.svelte';
  import type { ContextItem } from '../../input/context-api';
  import { createChatDraftStoreDriver } from './chat-draft-store-driver';
  import MockComposerInput from './MockComposerInput.svelte';

  let {
    drafts,
    workspaceId,
    agentId,
    onSaveError,
    showComposer = true,
  }: {
    drafts: Pick<DraftsClient, 'get' | 'set'> & Partial<Pick<DraftsClient, 'clear'>>;
    workspaceId?: string;
    agentId?: string;
    onSaveError?: (error: unknown) => void;
    /** Toggle to simulate the composer conditionally unmounting/remounting. */
    showComposer?: boolean;
  } = $props();

  let inputValue = $state('');
  let contextItems = $state<ContextItem[]>([]);
  let composer = $state<ReturnType<typeof MockComposerInput>>();

  const driver = createChatDraftStoreDriver({
    get: (...args) => drafts.get(...args),
    set: (...args) => drafts.set(...args),
    clear: (...args) => drafts.clear?.(...args) ?? Promise.resolve({ ok: true as const }),
  });

  const manager = createChatDraftManager({
    store: driver.port,
    workspaceId: () => workspaceId,
    agentId: () => agentId,
    inputValue: () => inputValue,
    setInputValue: (text) => (inputValue = text),
    contextItems: () => contextItems,
    setContextItems: (items) => (contextItems = items),
    applyEditorContent: (text) => composer?.setContent(text),
    onSaveError: (error) => onSaveError?.(error),
  });

  /**
   * Mirrors ChatPanel's performLocalSendCleanup: a send empties the composer
   * and invalidates the pending restore so a stale response can't repopulate
   * the just-sent prompt.
   */
  export function simulateSendCleanup() {
    manager.invalidatePendingRestore();
    contextItems = [];
    inputValue = '';
    composer?.setContent('');
    if (workspaceId && agentId) driver.dispatch(chatDraftClearRequested(workspaceId, agentId));
  }
</script>

{#if manager.gateVisible}
  <ChatDraftLoadingGate />
{/if}
{#if showComposer}
  <MockComposerInput
    bind:this={composer}
    bind:value={inputValue}
    inputLocked={manager.gateActive}
  />
{/if}
<div data-testid="context-count">{contextItems.length}</div>
