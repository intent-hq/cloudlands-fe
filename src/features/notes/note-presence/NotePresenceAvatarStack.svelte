<script lang="ts">
  /**
   * Header avatar stack of the other people currently viewing this note, fed
   * by the shared note-presence session (the daemon's viewer roster). Renders
   * nothing while the viewer is alone.
   */
  import { Tooltip } from '$lib/components/ui/tooltip';
  import { formatInteger } from '$lib/i18n/format';
  import { m } from '$shared/paraglide/messages.js';
  import { remoteCursorColor } from '$lib/components/tiptap/RemoteCursorDecorations';
  import { joinNotePresence, type RemoteNoteViewer } from './note-presence-service';

  interface Props {
    workspaceId: string;
    noteId: string;
    maxVisible?: number;
  }

  let { workspaceId, noteId, maxVisible = 3 }: Props = $props();

  let viewers = $state<RemoteNoteViewer[]>([]);

  $effect(() => {
    // eslint-disable-next-line intent/no-component-async-data-fetch -- synchronous lease on the transient presence stream (ephemeral UI state, not Redux domain data)
    const session = joinNotePresence(workspaceId, noteId);
    viewers = session.getViewers();
    const off = session.subscribe((next) => {
      viewers = next;
    });
    return () => {
      off();
      session.release();
      viewers = [];
    };
  });

  const visible = $derived(viewers.slice(0, maxVisible));
  const overflow = $derived(Math.max(0, viewers.length - maxVisible));
  const label = $derived(
    viewers.length === 1
      ? m.notes_presenceStack_viewers_one()
      : m.notes_presenceStack_viewers_many({ count: formatInteger(viewers.length) }),
  );

  function viewerName(viewer: RemoteNoteViewer): string {
    return viewer.displayName ?? viewer.login ?? viewer.principalId;
  }

  function viewerInitial(viewer: RemoteNoteViewer): string {
    return viewerName(viewer).slice(0, 1).toUpperCase();
  }
</script>

{#if viewers.length > 0}
  <div
    class="flex items-center -space-x-1.5 px-1"
    role="group"
    aria-label={label}
    data-testid="note-presence-avatar-stack"
  >
    {#each visible as viewer (viewer.principalId)}
      <Tooltip content={viewerName(viewer)} side="bottom">
        <!-- The tooltip trigger is the focusable control; its name is the
             persistent screen-reader text, the avatar itself is decorative. -->
        <span
          class="inline-flex h-5 w-5 items-center justify-center overflow-hidden rounded-full border-2 border-background text-xs font-medium leading-none text-white"
          style:background-color={remoteCursorColor(viewer.principalId)}
          data-principal-id={viewer.principalId}
          aria-hidden="true"
        >
          {#if viewer.avatarUrl}
            <img src={viewer.avatarUrl} alt="" class="h-full w-full object-cover" loading="lazy" />
          {:else}
            {viewerInitial(viewer)}
          {/if}
        </span>
        <span class="sr-only">{viewerName(viewer)}</span>
      </Tooltip>
    {/each}
    {#if overflow > 0}
      <span
        class="inline-flex h-5 min-w-5 items-center justify-center rounded-full border-2 border-background bg-muted px-1 text-xs font-medium leading-none text-muted-foreground"
      >
        {m.notes_presenceStack_overflow_label({ count: formatInteger(overflow) })}
      </span>
    {/if}
  </div>
{/if}
