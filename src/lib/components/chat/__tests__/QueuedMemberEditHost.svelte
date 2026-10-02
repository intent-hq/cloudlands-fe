<script lang="ts">
  import QueuedMessageList from '../QueuedMessageList.svelte';
  import { Button } from '$lib/components/ui/button';

  let { initialContent }: { initialContent: string } = $props();
  let savedContent = $state<string>();
  let edits = $state<{ id: string; content: string; editing?: boolean }[]>([]);
  let sent = $state('');
  let reversed = $state(false);
  let refresh = $state(0);
  const messages = $derived(
    [
      {
        id: 'member-queue',
        content: savedContent ?? initialContent,
        queuedAt: '2026-09-01T00:00:00Z',
        position: 0,
      },
      {
        id: 'other-queue',
        content: `Another queued message ${refresh}`,
        queuedAt: '2026-09-01T00:00:00Z',
        position: 1,
      },
    ].sort((left, right) =>
      reversed ? right.position - left.position : left.position - right.position,
    ),
  );
</script>

<!-- i18n-ignore (isolated functional test controls) -->
<div class="w-full" data-testid="queued-member-host">
  <QueuedMessageList
    {messages}
    onedit={async (id, content, editing) => {
      edits = [...edits, { id, content, editing }];
      if (!editing && id === 'member-queue') savedContent = content;
      return { success: true };
    }}
    onsendnow={(id) => {
      sent = id;
    }}
  />
  <Button onpointerdown={(event) => event.preventDefault()} onclick={() => (refresh += 1)}
    >Refresh queue</Button
  >
  <Button onpointerdown={(event) => event.preventDefault()} onclick={() => (reversed = !reversed)}
    >Reorder queue</Button
  >
  <Button>Outside editor</Button>
  <output hidden data-testid="queued-member-stored">{savedContent ?? initialContent}</output>
  <output hidden data-testid="queued-member-edits">{JSON.stringify(edits)}</output>
  <output hidden data-testid="queued-member-sent">{sent}</output>
</div>
