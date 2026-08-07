<script lang="ts">
  /**
   * ReleaseNotesModal — shows the running version's GitHub release notes.
   *
   * Opened automatically on the first launch after an update (main-process
   * push) and on demand from Help ▸ Show Release Notes. The markdown body is
   * rendered with the shared marked + DOMPurify pipeline; when no notes are
   * available the fallback message renders instead.
   */

  import Modal from '$lib/components/modals/Modal.svelte';
  import Button from '$lib/components/ui/button/button.svelte';
  import { openExternalUrl } from '$lib/utils/open-external';
  import { processMarkdownForDisplay } from '$lib/utils/markdown-processor';
  import { m } from '$shared/paraglide/messages.js';
  import type { ReleaseNotes } from '$store/renderer/slices/release-notes/release-notes-types';

  interface Props {
    open?: boolean;
    releaseNotes: ReleaseNotes | null;
    loading?: boolean;
    onClose?: () => void;
  }

  let { open = $bindable(false), releaseNotes, loading = false, onClose }: Props = $props();

  let notesHtml = $state('');
  $effect(() => {
    const markdown = releaseNotes?.notes ?? '';
    if (!markdown) {
      notesHtml = '';
      return;
    }
    let destroyed = false;
    void processMarkdownForDisplay(markdown).then((html) => {
      if (!destroyed) notesHtml = html;
    });
    return () => {
      destroyed = true;
    };
  });

  const title = $derived(
    releaseNotes
      ? m.releaseNotes_modal_title({ version: releaseNotes.version })
      : m.releaseNotes_modal_title_generic(),
  );

  function close() {
    open = false;
    onClose?.();
  }

  function openReleasePage() {
    if (!releaseNotes) return;
    // eslint-disable-next-line intent/no-component-async-data-fetch -- opens an external URL in the system browser, not a domain data fetch
    void openExternalUrl(releaseNotes.url);
  }
</script>

<Modal bind:open {title} contentClass="px-8 py-6" onClose={() => onClose?.()}>
  <div class="overflow-y-auto min-h-0">
    {#if loading}
      <p class="text-sm text-muted-foreground">{m.releaseNotes_modal_loading_message()}</p>
    {:else if releaseNotes && notesHtml}
      <div class="prose prose-sm dark:prose-invert max-w-none">
        <!-- eslint-disable-next-line svelte/no-at-html-tags (sanitized by processMarkdownForDisplay) -->
        {@html notesHtml}
      </div>
    {:else}
      <p class="text-sm text-muted-foreground">{m.releaseNotes_modal_unavailable_message()}</p>
    {/if}
  </div>

  <div class="pt-6 flex items-center justify-between gap-3 shrink-0">
    {#if releaseNotes}
      <Button variant="ghost" size="sm" onclick={openReleasePage}>
        {m.releaseNotes_modal_viewOnGitHub_label()}
      </Button>
    {:else}
      <span></span>
    {/if}
    <Button size="sm" onclick={close}>{m.releaseNotes_modal_dismiss_label()}</Button>
  </div>
</Modal>
