<script lang="ts" module>
  /** Decimal size label ("500 KB", "4.7 MB") for the truncation banner. */
  export function formatTruncatedNoteSize(bytes: number): string {
    if (bytes >= 1_000_000) {
      return m.layout_noteTab_truncated_sizeMb_label({
        value: formatNumber(bytes / 1_000_000, { maximumFractionDigits: 1 }),
      });
    }
    return m.layout_noteTab_truncated_sizeKb_label({
      value: formatNumber(Math.max(1, Math.round(bytes / 1_000)), { maximumFractionDigits: 0 }),
    });
  }
</script>

<script lang="ts">
  import Fa from 'svelte-fa';
  import { faTriangleExclamation } from '@fortawesome/free-solid-svg-icons';
  import { formatNumber } from '$lib/i18n/format';
  import { m } from '$shared/paraglide/messages.js';
  import RenderedNotePreview from './RenderedNotePreview.svelte';

  /**
   * Render-only view of a truncated note read (§5.2 "Truncated note reads").
   * Only the Markdown renderer and a banner: no editor, comments, presence,
   * line attribution or version actions are created for the note.
   */
  interface Props {
    content: string;
    /** Full UTF-8 size of the stored note (`contentBytes`). */
    contentBytes?: number;
    /** UTF-8 limit the view requested (`maxContentBytes`). */
    shownBytes: number;
    workspaceId: string;
    noteId: string;
    scrollKey: string;
    initialScrollPosition?: number;
    onScrollPositionSave?: (scrollKey: string, scrollTop: number) => void;
  }

  let {
    content,
    contentBytes,
    shownBytes,
    workspaceId,
    noteId,
    scrollKey,
    initialScrollPosition,
    onScrollPositionSave,
  }: Props = $props();

  const bannerText = $derived(
    contentBytes !== undefined
      ? m.layout_noteTab_truncated_banner_label({
          shown: formatTruncatedNoteSize(shownBytes),
          total: formatTruncatedNoteSize(contentBytes),
        })
      : m.layout_noteTab_truncated_bannerNoTotal_label({
          shown: formatTruncatedNoteSize(shownBytes),
        }),
  );
</script>

<div class="flex h-full min-h-0 flex-col" data-testid="truncated-note-view">
  <div
    class="flex items-start gap-2 border-b border-warning/30 bg-warning/10 px-4 py-2 text-sm"
    role="status"
    data-testid="truncated-note-banner"
  >
    <Fa icon={faTriangleExclamation} class="mt-0.5 shrink-0 text-warning" />
    <p>{bannerText}</p>
  </div>
  <div class="min-h-0 flex-1">
    <RenderedNotePreview
      {content}
      {workspaceId}
      {noteId}
      {scrollKey}
      {initialScrollPosition}
      {onScrollPositionSave}
    />
  </div>
</div>
