<script lang="ts">
  import InlineHtmlPreview from './InlineHtmlPreview.svelte';
  import CodeBlock from '$lib/components/editor/CodeBlock.svelte';
  import type { ParsedContent } from '$lib/utils/messageParser';
  import type { MessageRole } from '$shared/types';
  import { hasNodeOwnedAgentPath } from '$shared/utils/agent-node';
  import { store as appStore } from '$store/renderer/store';
  import { selectAgentSession } from '$store/renderer/slices/agent-session/agent-session-selectors';
  import { selectInlineVisual } from '$store/renderer/slices/inline-visuals/inline-visuals-selectors';
  import {
    inlineVisualOpened,
    inlineVisualChanged,
    inlineVisualRetryRequested,
    inlineVisualExportRequested,
  } from '$store/renderer/slices/inline-visuals/inline-visuals-slice';
  import { inlineVisualKey } from '$store/renderer/slices/inline-visuals/inline-visuals-types';
  import { INLINE_VISUAL_DRAFT_EVENT } from './inline-visual-handoff';
  import type { InlineVisualIdentity, InlineVisualSnapshot } from './inline-visual-types';

  let {
    block,
    role,
    workspaceId,
    agentId,
    messageId,
    contentBlockKey = '',
  }: {
    block: ParsedContent;
    role: MessageRole;
    workspaceId?: string;
    agentId?: string;
    messageId?: string;
    contentBlockKey?: string;
  } = $props();

  let root = $state<HTMLDivElement>();
  const agent$ = $derived(selectAgentSession(agentId ?? ''));
  const identity = $derived<InlineVisualIdentity | undefined>(
    role === 'assistant' &&
      workspaceId &&
      agentId &&
      messageId &&
      block.metadata?.fenceClosed &&
      !block.metadata?.isStreaming &&
      $agent$ &&
      !hasNodeOwnedAgentPath($agent$)
      ? {
          workspaceId,
          agentId,
          messageId,
          blockKey: JSON.stringify([contentBlockKey, block.metadata?.fenceStart ?? 0]),
          source: block.content,
        }
      : undefined,
  );
  const awaitingAgent = $derived(
    Boolean(workspaceId && agentId && messageId && block.metadata?.fenceClosed && !$agent$),
  );
  const key = $derived(identity ? inlineVisualKey(identity) : '');
  const entry$ = $derived(selectInlineVisual(key));

  $effect(() => {
    if (identity) appStore.dispatch(inlineVisualOpened(identity));
  });

  function useConfiguration(snapshot: InlineVisualSnapshot): void {
    if (!workspaceId || !agentId || $agent$?.retiredAt) return;
    root?.dispatchEvent(
      new CustomEvent(INLINE_VISUAL_DRAFT_EVENT, {
        bubbles: true,
        detail: { workspaceId, agentId, snapshot },
      }),
    );
  }
</script>

{#if role === 'assistant'}
  <div bind:this={root} class="w-full min-w-0">
    <InlineHtmlPreview
      source={block.content}
      isStreaming={block.metadata?.isStreaming ?? false}
      isComplete={block.metadata?.fenceClosed ?? false}
      record={$entry$?.record}
      storageStatus={identity
        ? ($entry$?.status ?? 'loading')
        : awaitingAgent
          ? 'loading'
          : 'ready'}
      storageError={$entry$?.error}
      onRecordChange={identity
        ? (record) => appStore.dispatch(inlineVisualChanged(key, record))
        : undefined}
      onUseConfiguration={workspaceId && agentId && $agent$ && !$agent$.retiredAt
        ? useConfiguration
        : undefined}
      onRetry={identity ? () => appStore.dispatch(inlineVisualRetryRequested(key)) : undefined}
      onExport={identity
        ? (record) =>
            appStore.dispatch(inlineVisualExportRequested(key, crypto.randomUUID(), record))
        : undefined}
      exportStatus={$entry$?.export?.status}
      exportPath={$entry$?.export?.path}
      exportError={$entry$?.export?.error}
    />
  </div>
{:else}
  <CodeBlock code={block.content} language="html" />
{/if}
