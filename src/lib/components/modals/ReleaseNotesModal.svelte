<script lang="ts">
  /**
   * ReleaseNotesModal — shows the running version's GitHub release notes.
   *
   * Opened automatically on the first launch after an update (main-process
   * push) and on demand from Help ▸ Show Release Notes. Built directly on the
   * shared Dialog primitives: fixed header and footer with the markdown body
   * (rendered by the shared MarkdownViewer) scrolling in between.
   * Release-notes typography is scoped under `.release-notes-body`, so the
   * shared viewer is untouched everywhere else.
   */

  import * as Dialog from '$lib/components/ui/dialog';
  import Button from '$lib/components/ui/button/button.svelte';
  import MarkdownViewer from '$lib/components/markdown/MarkdownViewer.svelte';
  import { openExternalUrl } from '$lib/utils/open-external';
  import { m } from '$shared/paraglide/messages.js';
  import type { ReleaseNotes } from '$store/renderer/slices/release-notes/release-notes-types';

  interface Props {
    open?: boolean;
    releaseNotes: ReleaseNotes | null;
    loading?: boolean;
    onClose?: () => void;
  }

  let { open = $bindable(false), releaseNotes, loading = false, onClose }: Props = $props();

  const title = $derived(
    releaseNotes
      ? m.releaseNotes_modal_title({ version: releaseNotes.version })
      : m.releaseNotes_modal_title_generic(),
  );

  // The generated release body opens with an "Intent vX.Y.Z" line that
  // duplicates the dialog title. Strip it only when it matches this release's
  // version; any other body renders untouched.
  const displayNotes = $derived.by(() => {
    const notes = releaseNotes?.notes ?? '';
    if (!notes || !releaseNotes) return notes;
    const newlineIndex = notes.search(/\r?\n/);
    const firstLine = (newlineIndex === -1 ? notes : notes.slice(0, newlineIndex)).trim();
    const match = firstLine.match(/^(?:#{1,6}\s+)?Intent\s+v?(\d[\w.+-]*)$/i);
    const version = releaseNotes.version.replace(/^v/i, '').toLowerCase();
    if (!match || match[1].toLowerCase() !== version) return notes;
    return newlineIndex === -1 ? '' : notes.slice(newlineIndex).replace(/^(?:\r?\n)+/, '');
  });

  function close() {
    open = false;
    onClose?.();
  }

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen) onClose?.();
  }

  function openReleasePage() {
    if (!releaseNotes) return;
    // eslint-disable-next-line intent/no-component-async-data-fetch -- opens an external URL in the system browser, not a domain data fetch
    void openExternalUrl(releaseNotes.url);
  }
</script>

<Dialog.Root bind:open onOpenChange={handleOpenChange}>
  <Dialog.Content
    class="release-notes-dialog flex max-w-2xl flex-col gap-0 overflow-hidden rounded-lg p-0"
  >
    <div class="flex shrink-0 items-center border-b border-border px-6 py-4 pr-12">
      <Dialog.Title class="type-title text-foreground">{title}</Dialog.Title>
    </div>

    <div class="release-notes-body min-h-0 flex-1 overflow-y-auto px-6 py-5">
      {#if loading}
        <p class="text-sm text-muted-foreground">{m.releaseNotes_modal_loading_message()}</p>
      {:else if displayNotes}
        <MarkdownViewer content={displayNotes} />
      {:else}
        <p class="text-sm text-muted-foreground">{m.releaseNotes_modal_unavailable_message()}</p>
      {/if}
    </div>

    <Dialog.Footer
      class="mt-0 shrink-0 flex-row items-center justify-between gap-3 px-6 py-3 sm:justify-between"
    >
      {#if releaseNotes}
        <Button variant="ghost" size="sm" onclick={openReleasePage}>
          {m.releaseNotes_modal_viewOnGitHub_label()}
        </Button>
      {:else}
        <span></span>
      {/if}
      <Button size="sm" onclick={close}>{m.releaseNotes_modal_dismiss_label()}</Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>

<style>
  /* Cap the dialog height so long release bodies scroll inside the body pane
     while the header and footer stay fixed. Doubles the class on the shared
     editorial content rule to win its max-height deterministically. */
  :global(.dialog-editorial-content.release-notes-dialog) {
    max-height: min(85dvh, 44rem);
  }

  /* Release-notes typography over the shared MarkdownViewer output — scoped
     under .release-notes-body so no other MarkdownViewer usage is affected.
     Selectors include .markdown-viewer to outrank the viewer's own rules. */

  /* h2 (component sections) → prominent section headers with separation */
  .release-notes-body :global(.markdown-viewer h2) {
    margin-top: 1.75rem;
    margin-bottom: 0.75rem;
    padding-top: 1.25rem;
    border-top: 1px solid hsl(var(--border));
    font-size: 1rem;
    font-weight: 600;
    letter-spacing: -0.01em;
    line-height: 1.4;
  }

  .release-notes-body :global(.markdown-viewer h2:first-child) {
    margin-top: 0;
    padding-top: 0;
    border-top: none;
  }

  /* h3 (Features / Bug Fixes / …) → small uppercase eyebrow labels */
  .release-notes-body :global(.markdown-viewer h3) {
    margin-top: 1.25rem;
    margin-bottom: 0.375rem;
    font-size: 0.6875rem;
    font-weight: 600;
    letter-spacing: 0.08em;
    line-height: 1.4;
    text-transform: uppercase;
    color: hsl(var(--muted-foreground));
  }

  /* Tighter, well-spaced bullet lists */
  .release-notes-body :global(.markdown-viewer ul) {
    margin: 0.25rem 0 0;
    padding-left: 1.125rem;
  }

  .release-notes-body :global(.markdown-viewer li) {
    margin: 0.375rem 0;
  }

  .release-notes-body :global(.markdown-viewer li::marker) {
    color: hsl(var(--muted-foreground) / 0.6);
  }

  /* PR-number links → subtle inline chips */
  .release-notes-body :global(.markdown-viewer a[href*='/pull/']) {
    display: inline-block;
    padding: 0 0.375rem;
    border-radius: 9999px;
    background: hsl(var(--muted) / 0.5);
    color: hsl(var(--muted-foreground));
    font-family: var(--font-code);
    font-size: 0.75rem;
    line-height: 1.25rem;
    text-decoration: none;
  }

  .release-notes-body :global(.markdown-viewer a[href*='/pull/']:hover),
  .release-notes-body :global(.markdown-viewer a[href*='/pull/']:focus-visible) {
    background: hsl(var(--muted));
    color: hsl(var(--foreground));
    text-decoration: none;
  }
</style>
