<script lang="ts">
  import { untrack } from 'svelte';
  import { Button } from '$lib/components/ui/button';
  import MessageComposer from './message-composer.svelte';
  import type { QueuedMessage } from './types';

  let {
    initialValue = '',
    initialStatus = 'idle',
    initialQueue = [],
    initialFiles = [],
    suggestions = [],
    placeholderSuggestion,
    history = [],
  }: {
    initialValue?: string;
    initialStatus?: 'idle' | 'streaming';
    initialQueue?: QueuedMessage[];
    initialFiles?: File[];
    suggestions?: string[];
    placeholderSuggestion?: string;
    history?: string[];
  } = $props();

  let value = $state(untrack(() => initialValue));
  let status = $state<'idle' | 'streaming'>(untrack(() => initialStatus));
  let queue = $state<QueuedMessage[]>(untrack(() => initialQueue));
  let files = $state<File[]>(untrack(() => initialFiles));
  let stopped = $state(0);
  let sends = $state<Array<{ text: string; queuedId?: string }>>([]);
</script>

<MessageComposer
  bind:value
  {status}
  {queue}
  {files}
  {suggestions}
  {placeholderSuggestion}
  {history}
  onValueChange={(next) => (value = next)}
  onQueueChange={(next) => (queue = next)}
  onFilesChange={(next) => (files = next)}
  onStop={() => (stopped += 1)}
  onSend={(text, _files, meta) => (sends = [...sends, { text, queuedId: meta?.queuedId }])}
/>
<div class="mt-2 flex gap-2">
  <Button size="xs" onclick={() => (status = 'idle')}>Finish response</Button>
  <Button size="xs" onclick={() => (status = 'streaming')}>Start response</Button>
</div>
<output data-testid="value">{value}</output>
<output data-testid="queue">{queue.map((item) => item.id).join(',')}</output>
<output data-testid="stopped">{stopped}</output>
<output data-testid="sends">{JSON.stringify(sends)}</output>
