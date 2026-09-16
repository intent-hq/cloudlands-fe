<script lang="ts">
  import type { ContextAttachment } from '$store/renderer/slices/context/context-types';
  import { store as appStore } from '$store/renderer/store';
  import { messageBlockHydrationRequested } from '$store/renderer/slices/chat-state/chat-state-slice';
  import { openWorkspaceAttachment } from '$store/renderer/slices/workspace-navigation/workspace-navigation-slice';
  import { Button } from '$lib/components/ui/button';
  import Fa from 'svelte-fa';
  import {
    faFile,
    faFileLines,
    faPlay,
    faCircleNotch,
    faTriangleExclamation,
  } from '@fortawesome/free-solid-svg-icons';
  import SidebarGroupHeader from '$lib/components/workspace/sidebar/SidebarGroupHeader.svelte';
  import ContextImageThumbnail from './ContextImageThumbnail.svelte';
  import { formatInteger } from '$lib/i18n/format';
  import { m } from '$shared/paraglide/messages.js';

  let { attachments, workspaceId }: { attachments: ContextAttachment[]; workspaceId: string } =
    $props();
  let expanded = $state(true);
</script>

{#if attachments.length > 0}
  <section class="mt-3" aria-label={m.context_attachments_title_label()}>
    <SidebarGroupHeader
      title={m.context_attachments_title_label()}
      meta={formatInteger(attachments.length)}
      {expanded}
      onclick={() => (expanded = !expanded)}
    />
    {#if expanded}
      <div class="grid grid-cols-3 gap-2 p-2" data-context-attachment-grid>
        {#each attachments as attachment, index (attachment.id)}
          {#if attachment.block.type === 'image' || attachment.block.mimeType?.startsWith('image/')}
            <ContextImageThumbnail
              image={attachment}
              {workspaceId}
              name={attachment.name ||
                m.chat_chatMessage_attachedImage_alt({ number: formatInteger(index + 1) })}
              onHydrate={attachment.agentId && attachment.messageId && attachment.block.id
                ? () =>
                    appStore.dispatch(
                      messageBlockHydrationRequested(
                        attachment.agentId!,
                        attachment.messageId!,
                        attachment.block.id!,
                      ),
                    )
                : undefined}
            />
          {:else}
            {@const name = attachment.name ?? attachment.block.fileName ?? ''}
            {@const placing = attachment.placementStatus === 'placing'}
            {@const failed = attachment.placementStatus === 'failed'}
            {@const label = failed
              ? m.chat_attachmentPreview_placementFailed_tooltip({ name })
              : placing
                ? m.context_attachments_uploading_ariaLabel({ name })
                : m.chat_chatMessage_openAttachment_title({ name })}
            <Button
              variant="plain"
              wrapContent={false}
              class="aspect-square h-auto w-full min-w-0 flex-col gap-2 overflow-hidden rounded-md border border-border bg-muted/30 p-2"
              aria-label={label}
              title={label}
              aria-busy={placing}
              disabled={!attachment.block.attachmentId || placing || failed}
              onclick={() =>
                appStore.dispatch(
                  openWorkspaceAttachment(workspaceId, attachment.block.attachmentId!, name),
                )}
            >
              <Fa
                icon={placing
                  ? faCircleNotch
                  : failed
                    ? faTriangleExclamation
                    : attachment.block.mimeType === 'application/pdf'
                      ? faFileLines
                      : attachment.block.mimeType?.startsWith('video/')
                        ? faPlay
                        : faFile}
                class={failed
                  ? 'size-5 shrink-0 text-danger'
                  : 'size-5 shrink-0 text-muted-foreground'}
              />
              <span class="w-full truncate type-caption text-foreground">{name}</span>
            </Button>
          {/if}
        {/each}
      </div>
    {/if}
  </section>
{/if}
