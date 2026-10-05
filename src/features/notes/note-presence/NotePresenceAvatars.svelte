<script lang="ts">
  /**
   * Presentational avatar stack of the other people viewing a note. Renders
   * nothing while the list is empty; `NotePresenceAvatarStack` feeds it from
   * the shared note-presence session, the component catalog from fixtures.
   */
  import PrincipalAvatar from '$lib/components/ui/PrincipalAvatar.svelte';
  import { Tooltip } from '$lib/components/ui/tooltip';
  import { formatInteger } from '$lib/i18n/format';
  import { m } from '$shared/paraglide/messages.js';
  import { remoteCursorColor } from '$lib/components/tiptap/RemoteCursorDecorations';
  import type { RemoteNoteViewer } from './note-presence-service';

  interface Props {
    viewers: RemoteNoteViewer[];
    maxVisible?: number;
  }

  let { viewers, maxVisible = 3 }: Props = $props();

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
          class="inline-flex h-5 w-5 items-center justify-center overflow-hidden rounded-full border-2 border-background text-xs font-medium leading-none text-primary-foreground"
          style:background-color={remoteCursorColor(viewer.principalId)}
          data-principal-id={viewer.principalId}
          aria-hidden="true"
        >
          <PrincipalAvatar fill avatarUrl={viewer.avatarUrl} label={viewerName(viewer)} />
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
