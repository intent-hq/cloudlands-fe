<script lang="ts">
  import { followBottom, type FollowBottomState } from '$lib/utils/smartScroll';
  import QueuedMessageList from '../QueuedMessageList.svelte';

  interface Props {
    theme?: 'light' | 'dark';
    width?: number;
    zoom?: number;
    messageCount?: number;
  }

  let { theme = 'light', width = 640, zoom = 1, messageCount = 3 }: Props = $props();
  let follow = $state(true);
  let distance = $state(0);
  let refresh = $state(0);
  let reversed = $state(false);
  let removed = $state<string[]>([]);
  let savedContent = $state<Record<string, string>>({});
  const messages = $derived(
    Array.from({ length: messageCount }, (_, index) => ({
      id: `motion-${index}`,
      content:
        savedContent[`motion-${index}`] ??
        `Queued message ${index + 1} has enough content to exercise intrinsic row height ${refresh}`,
      queuedAt: '2026-01-01T00:00:00.000Z',
      position: reversed ? messageCount - index - 1 : index,
      editing: false,
    }))
      .filter((message) => !removed.includes(message.id))
      .sort((a, b) => a.position - b.position),
  );

  function report(state: FollowBottomState) {
    distance = state.distanceFromBottom;
  }

  function preserveEditorFocus(event: PointerEvent) {
    event.preventDefault();
  }
</script>

<section
  class="flex h-[420px] flex-col bg-background text-foreground"
  class:dark={theme === 'dark'}
  style:width="{width}px"
  style:zoom
  data-testid="queued-edit-motion-host"
>
  <div
    use:followBottom={{
      follow,
      threshold: 60,
      onFollowChange: (next) => (follow = next),
      onScrollStateChange: report,
    }}
    class="min-h-0 flex-1 overflow-y-auto"
    data-testid="queued-edit-transcript"
  >
    <div class="h-[620px] px-3 py-2">Transcript history</div>
    <QueuedMessageList
      {messages}
      onedit={async (id, content, editing) => {
        if (!editing) savedContent = { ...savedContent, [id]: content };
        refresh += 1;
        return { success: true };
      }}
      onremove={(id) => (removed = [...removed, id])}
    />
  </div>
  <output data-testid="queued-edit-bottom-state">{follow ? 'locked' : 'unlocked'}:{distance}</output
  >
  <div role="group" aria-label="Daemon queue controls">
    <button
      type="button"
      data-testid="queued-edit-refresh"
      onpointerdown={preserveEditorFocus}
      onclick={() => (refresh += 1)}>Refresh</button
    >
    <button
      type="button"
      data-testid="queued-edit-reorder"
      onpointerdown={preserveEditorFocus}
      onclick={() => (reversed = !reversed)}>Reorder</button
    >
    <button
      type="button"
      data-testid="queued-edit-remove"
      onclick={() => (removed = [...removed, 'motion-1'])}
    >
      Remove
    </button>
  </div>
</section>
