<script lang="ts">
  import AtIcon from 'phosphor-svelte/lib/AtIcon';
  import PaperclipIcon from 'phosphor-svelte/lib/PaperclipIcon';
  import SparkleIcon from 'phosphor-svelte/lib/SparkleIcon';
  import { untrack } from 'svelte';
  import type { UiComponentFixture } from '$lib/components/ui/component-metadata';
  import { Button } from '$lib/components/ui/button';
  import {
    MessageComposer,
    type MessageComposerSlotContext,
    type QueuedMessage,
  } from '$lib/components/ui/message-composer';

  let { fixture }: { componentId: 'message-composer'; fixture: UiComponentFixture } = $props();
  const sampleFiles =
    typeof File === 'undefined'
      ? []
      : [
          new File(['preview'], 'workspace-map.png', { type: 'image/png' }),
          new File(['notes'], 'brief.pdf', { type: 'application/pdf' }),
        ];
  const initialQueue: QueuedMessage[] = [
    { id: 'catalog-1', text: 'Summarize the implementation plan', files: [] },
    { id: 'catalog-2', text: 'Then identify the main risks', files: sampleFiles.slice(0, 1) },
  ];

  let value = $state(
    untrack(() => (fixture.id === 'basic' ? 'Try recalling message history' : '')),
  );
  let files = $state<File[]>(untrack(() => (fixture.id === 'attachments' ? sampleFiles : [])));
  let queue = $state<QueuedMessage[]>(
    untrack(() => (fixture.id === 'queued-messages' ? initialQueue : [])),
  );
  let status = $state<'idle' | 'streaming'>(
    untrack(() => (fixture.id === 'queued-messages' ? 'streaming' : 'idle')),
  );
  let sendStatus = $state('No message sent yet');

  const placeholderSuggestion = $derived(
    fixture.id === 'suggestions' ? 'Summarize the current workspace' : undefined,
  );
  const suggestions = $derived(
    fixture.id === 'suggestions'
      ? ['Explain the latest changes', 'Draft a concise release note', 'List the remaining risks']
      : [],
  );
  const history = $derived(
    fixture.id === 'basic' ? ['Review the architecture', 'Summarize the open tasks'] : [],
  );

  function handleSend(text: string) {
    sendStatus = `Sent: ${text}`;
    value = '';
    status = 'streaming';
  }
</script>

{#snippet attachSlot({ openFilePicker, files: attached }: MessageComposerSlotContext)}
  <Button
    variant="ghost-light"
    size="icon-sm"
    iconOnly
    aria-label="Attach files"
    onclick={() => openFilePicker()}
  >
    <PaperclipIcon aria-hidden="true" />
  </Button>
  {#if attached.length}<span class="text-xs text-muted-foreground">{attached.length} attached</span
    >{/if}
{/snippet}

{#snippet leftOnlySlot(_context: MessageComposerSlotContext)}
  <Button variant="ghost-light" size="icon-sm" iconOnly aria-label="Add mention"
    ><AtIcon aria-hidden="true" /></Button
  >
{/snippet}

{#snippet rightOnlySlot(_context: MessageComposerSlotContext)}
  <Button variant="ghost-light" size="icon-sm" iconOnly aria-label="Enhance prompt"
    ><SparkleIcon aria-hidden="true" /></Button
  >
{/snippet}

<div
  class="grid w-full min-w-0 max-w-2xl gap-3"
  data-catalog-renderer-fixture={fixture.id}
  data-catalog-rendered-state={fixture.states.join(' ')}
>
  <MessageComposer
    bind:value
    {files}
    {queue}
    {status}
    {history}
    {suggestions}
    {placeholderSuggestion}
    disabled={fixture.id === 'disabled'}
    leftSlot={fixture.id === 'attachments'
      ? attachSlot
      : fixture.id === 'left-slot-only'
        ? leftOnlySlot
        : undefined}
    rightSlot={fixture.id === 'right-slot-only' ? rightOnlySlot : undefined}
    placeholder={fixture.id === 'disabled' ? 'Composer unavailable' : 'Ask me anything…'}
    onValueChange={(next) => (value = next)}
    onFilesChange={(next) => (files = next)}
    onQueueChange={(next) => (queue = next)}
    onStop={() => {
      status = 'idle';
      sendStatus = 'Stopped response';
    }}
    onSend={(text) => handleSend(text)}
  />

  {#if fixture.id === 'playground'}
    <div class="flex flex-wrap gap-2">
      <Button size="xs" onclick={() => (status = status === 'idle' ? 'streaming' : 'idle')}
        >Toggle streaming</Button
      >
      <Button size="xs" variant="outline" onclick={() => (value = 'Queue this follow-up')}
        >Add draft</Button
      >
    </div>
  {/if}
  {#if fixture.id === 'send-handler' || fixture.id === 'playground'}
    <output class="text-xs text-muted-foreground" aria-live="polite">{sendStatus}</output>
  {/if}
</div>
