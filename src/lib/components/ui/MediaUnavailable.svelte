<script lang="ts">
  import {
    faArrowUpRightFromSquare,
    faCopy,
    faTriangleExclamation,
  } from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';
  import { toast } from 'svelte-sonner';
  import { handleLink } from '$features/navigation/link-handler';
  import { m } from '$shared/paraglide/messages.js';
  import { WorkspaceId } from '$shared/types/branded-ids';
  import { Button } from '$lib/components/ui/button';
  import { writeTextToClipboard } from '$lib/utils/clipboard';

  type MediaUnavailableReason = 'missing' | 'unsupported' | 'load-failed';

  interface Props {
    name?: string;
    reason: MediaUnavailableReason;
    path?: string;
    workspaceId?: string;
  }

  let { name, reason, path, workspaceId }: Props = $props();

  const reasonText = $derived.by(() => {
    if (reason === 'missing') return m.ui_mediaUnavailable_missing_description();
    if (reason === 'unsupported') return m.ui_mediaUnavailable_unsupported_description();
    return m.ui_mediaUnavailable_loadFailed_description();
  });

  async function copyPath() {
    if (!path) return;
    try {
      await writeTextToClipboard(path);
      toast.success(m.ui_imageActionsMenu_pathCopied_label());
    } catch {
      toast.error(m.ui_imageActionsMenu_copyFailed_error());
    }
  }

  function openFile() {
    if (!path || !workspaceId) return;
    const encodedPath = path.split('/').map(encodeURIComponent).join('/');
    void handleLink(`intent://local/file/${encodedPath}`, {
      workspaceId: WorkspaceId(workspaceId),
    });
  }
</script>

<div
  class="flex w-fit min-w-0 max-w-full flex-wrap items-center gap-x-2 gap-y-1.5 rounded-lg border border-dashed border-border bg-muted/30 px-2.5 py-2 text-muted-foreground"
  role="status"
  data-testid="media-unavailable"
  data-reason={reason}
>
  <Fa icon={faTriangleExclamation} class="size-3.5 shrink-0" />
  <span class="min-w-0 flex-1">
    <span class="type-caption block truncate font-medium text-foreground" title={name}>
      {name || m.ui_mediaUnavailable_title_label()}
    </span>
    <span class="type-caption block">{reasonText}</span>
  </span>
  {#if path}
    <span class="flex shrink-0 items-center gap-1">
      <Button variant="ghost-light" size="xs" class="h-6" onclick={copyPath}>
        <Fa icon={faCopy} size="xs" />
        {m.ui_imageActionsMenu_copyPath_label()}
      </Button>
      {#if workspaceId}
        <Button variant="ghost-light" size="xs" class="h-6" onclick={openFile}>
          <Fa icon={faArrowUpRightFromSquare} size="xs" />
          {m.chat_changesPanel_openFile_tooltip()}
        </Button>
      {/if}
    </span>
  {/if}
</div>
