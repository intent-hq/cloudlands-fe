<!-- @catalog-exempt: inline media status composed from the catalogued Button -->

<script lang="ts">
  import {
    faArrowUpRightFromSquare,
    faCopy,
    faImage,
    faRotateRight,
  } from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';
  import { notify } from '$lib/components/patterns/notify';
  import { handleLink } from '$features/navigation/link-handler';
  import { m } from '$shared/paraglide/messages.js';
  import { WorkspaceId } from '$shared/types/branded-ids';
  import { Button } from '$lib/components/ui/button';
  import { truncatedTitle } from '$lib/actions/observe-overflow';
  import { writeTextToClipboard } from '$lib/utils/clipboard';

  type MediaUnavailableReason =
    'missing' | 'unsupported' | 'load-failed' | 'other-workspace' | 'invalid-link';

  interface Props {
    name?: string;
    reason: MediaUnavailableReason;
    path?: string;
    workspaceId?: string;
    /** The media owner resets loading state and starts a fresh attempt. */
    onRetry?: () => void;
  }

  let { name, reason, path, workspaceId, onRetry }: Props = $props();

  const reasonText = $derived.by(() => {
    if (reason === 'missing') return m.ui_mediaUnavailable_missing_description();
    if (reason === 'unsupported') return m.ui_mediaUnavailable_unsupported_description();
    if (reason === 'other-workspace') return m.ui_mediaUnavailable_otherWorkspace_description();
    if (reason === 'invalid-link') return m.ui_mediaUnavailable_invalidLink_description();
    return m.ui_mediaUnavailable_loadFailed_description();
  });

  function stopLinkActivation(event: MouseEvent) {
    event.preventDefault();
    event.stopPropagation();
  }

  function retry(event: MouseEvent) {
    stopLinkActivation(event);
    onRetry?.();
  }

  async function copyPath(event: MouseEvent) {
    stopLinkActivation(event);
    if (!path) return;
    try {
      await writeTextToClipboard(path);
      notify.success(m.ui_imageActionsMenu_pathCopied_label());
    } catch {
      notify.error(m.ui_imageActionsMenu_copyFailed_error());
    }
  }

  function openFile(event: MouseEvent) {
    stopLinkActivation(event);
    if (!path || !workspaceId) return;
    const encodedPath = path.split('/').map(encodeURIComponent).join('/');
    void handleLink(`intent://local/file/${encodedPath}`, {
      workspaceId: WorkspaceId(workspaceId),
    });
  }
</script>

<div
  class="type-caption flex w-fit min-w-0 max-w-full items-center gap-3 whitespace-normal py-1 text-muted-foreground"
  role="status"
  data-testid="media-unavailable"
  data-reason={reason}
>
  <span class="flex min-w-0 max-w-full flex-1 items-start gap-2">
    <span class="first-line-icon" aria-hidden="true">
      <Fa icon={faImage} class="size-3.5" />
    </span>
    <span class="min-w-0">
      {#if name}
        <span class="block truncate text-foreground" use:truncatedTitle={name}>{name}</span>
      {/if}
      <span class="block break-words">{reasonText}</span>
    </span>
  </span>
  {#if onRetry || path}
    <span class="flex shrink-0 flex-wrap items-center gap-1">
      {#if onRetry}
        <Button
          variant="ghost"
          size="icon-compact"
          tooltip={m.chat_shared_retry_label()}
          onclick={retry}
        >
          <Fa icon={faRotateRight} size="xs" />
        </Button>
      {/if}
      {#if path}
        {#if workspaceId && reason !== 'other-workspace' && reason !== 'invalid-link'}
          <Button variant="ghost" size="compact" onclick={openFile}>
            <Fa icon={faArrowUpRightFromSquare} size="xs" />
            {m.chat_changesPanel_openFile_tooltip()}
          </Button>
        {/if}
        <Button
          variant="ghost"
          size="icon-compact"
          tooltip={m.ui_imageActionsMenu_copyPath_label()}
          onclick={copyPath}
        >
          <Fa icon={faCopy} size="xs" />
        </Button>
      {/if}
    </span>
  {/if}
</div>
