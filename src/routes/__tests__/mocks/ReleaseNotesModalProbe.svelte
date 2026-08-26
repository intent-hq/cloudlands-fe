<script lang="ts">
  import type { ReleaseNotes } from '$store/renderer/slices/release-notes/release-notes-types';

  interface Props {
    open?: boolean;
    releaseNotes: ReleaseNotes | null;
    onClose?: () => void;
  }

  let { open = false, releaseNotes, onClose }: Props = $props();

  (globalThis as Record<string, unknown>).__releaseNotesModalProps = {
    get open() {
      return open;
    },
    get releaseNotes() {
      return releaseNotes;
    },
    close: () => onClose?.(),
  };
</script>

<div data-testid="release-notes-modal-host"></div>
{#if open}
  <div data-testid="release-notes-modal-marker"></div>
{/if}
