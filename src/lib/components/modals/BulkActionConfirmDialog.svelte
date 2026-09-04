<script lang="ts">
  import { onDestroy } from 'svelte';
  import { scrollFade } from '$lib/actions/scroll-fade';
  import { Button } from '$lib/components/ui/button';
  import type { ButtonVariant } from '$lib/components/ui/button';
  import * as Dialog from '$lib/components/ui/dialog';
  import HoverCard from '$lib/components/ui/HoverCard.svelte';
  import WorkspaceHoverCard from '$lib/components/workspace/WorkspaceHoverCard.svelte';
  import WorkspaceStatusIcon from '$lib/components/workspace/WorkspaceStatusIcon.svelte';
  import {
    getWorkspaceStatusPresentation,
    resolveWorkspaceStatusState,
  } from '$lib/components/workspace/utils/workspace-status-presentation';
  import { workspaceHoverCardIntentSession } from '$lib/components/workspace/utils/workspace-hover-card-intent';
  import { m } from '$shared/paraglide/messages.js';
  import { formatInteger } from '$lib/i18n/format';
  import { type Workspace, WorkspaceStatusEnum } from '$shared/types';

  interface Props {
    open?: boolean;
    title?: string;
    description?: string;
    confirmText?: string;
    variant?: ButtonVariant;
    workspaces?: Workspace[];
    /** Streaming agents across the targeted workspaces that the action would stop. */
    activeAgentCount?: number;
    /** Active background hooks across the targeted workspaces that the action would cancel. */
    activeHookCount?: number;
    onConfirm?: () => void;
    onCancel?: () => void;
  }

  let {
    open = $bindable(false),
    title = m.modals_bulkActionConfirm_title(),
    description = '',
    confirmText = m.modals_bulkActionConfirm_confirm_label(),
    variant = 'default',
    workspaces = [],
    activeAgentCount = 0,
    activeHookCount = 0,
    onConfirm,
    onCancel,
  }: Props = $props();

  const hasActiveWork = $derived(activeAgentCount > 0 || activeHookCount > 0);

  let confirmButtonRef: HTMLButtonElement | null = $state(null);
  let confirmHasFocus = $state(false);
  let hoveredWorkspaceId: Workspace['id'] | null = null;
  let hoverCardWorkspace: Workspace | null = $state(null);
  let hoverCardAnchorElement: HTMLDivElement | null = $state(null);
  let hoverCardOpenTimer: ReturnType<typeof setTimeout> | null = null;
  let hoverCardOpenedFromPointer = false;

  function clearHoverCardOpenTimer() {
    if (hoverCardOpenTimer === null) return;
    clearTimeout(hoverCardOpenTimer);
    hoverCardOpenTimer = null;
  }

  function closeHoverCard() {
    hoverCardWorkspace = null;
    hoverCardAnchorElement = null;
    if (!hoverCardOpenedFromPointer) return;
    hoverCardOpenedFromPointer = false;
    workspaceHoverCardIntentSession.notifyClosed();
  }

  function handleWorkspaceMouseEnter(workspace: Workspace, event: MouseEvent) {
    hoveredWorkspaceId = workspace.id;
    clearHoverCardOpenTimer();
    if (hoverCardWorkspace?.id !== workspace.id) closeHoverCard();
    const anchorElement = event.currentTarget as HTMLDivElement;
    hoverCardOpenTimer = setTimeout(() => {
      hoverCardOpenTimer = null;
      if (hoveredWorkspaceId !== workspace.id) return;
      hoverCardWorkspace = workspace;
      hoverCardAnchorElement = anchorElement;
      if (hoverCardOpenedFromPointer) return;
      hoverCardOpenedFromPointer = true;
      workspaceHoverCardIntentSession.notifyOpened();
    }, workspaceHoverCardIntentSession.currentOpenDelay);
  }

  function handleWorkspaceMouseLeave(workspace: Workspace) {
    if (hoveredWorkspaceId !== workspace.id) return;
    hoveredWorkspaceId = null;
    clearHoverCardOpenTimer();
    closeHoverCard();
  }

  function close() {
    open = false;
    onCancel?.();
  }

  async function handleConfirm() {
    try {
      await onConfirm?.();
    } catch (error) {
      console.error('Confirm action failed:', error);
    }
    open = false;
  }

  function handleOpenAutoFocus(event: Event) {
    event.preventDefault();
    confirmButtonRef?.focus();
  }

  $effect(() => {
    if (open) return;
    hoveredWorkspaceId = null;
    clearHoverCardOpenTimer();
    closeHoverCard();
  });

  onDestroy(() => {
    clearHoverCardOpenTimer();
    closeHoverCard();
  });
</script>

<Dialog.Root {open} onOpenChange={(nextOpen) => !nextOpen && close()}>
  <Dialog.Content
    class="max-w-sm gap-0 overflow-hidden p-0"
    closeLabel={m.modals_bulkActionConfirm_close_ariaLabel()}
    onOpenAutoFocus={handleOpenAutoFocus}
  >
    <div class="min-w-0 space-y-4 p-5 pr-12">
      <Dialog.Header class="gap-2 pr-0">
        <Dialog.Title>{title}</Dialog.Title>
        <Dialog.Description class="leading-5">{description}</Dialog.Description>
      </Dialog.Header>

      {#if hasActiveWork}
        <div class="space-y-1">
          {#if activeAgentCount > 0}
            <p class="text-sm text-muted-foreground">
              {activeAgentCount === 1
                ? m.modals_deleteWarning_agentsStopped_one({
                    count: formatInteger(activeAgentCount),
                  })
                : m.modals_deleteWarning_agentsStopped_many({
                    count: formatInteger(activeAgentCount),
                  })}
            </p>
          {/if}
          {#if activeHookCount > 0}
            <p class="text-sm text-muted-foreground">
              {activeHookCount === 1
                ? m.modals_deleteWarning_hooksCancelled_one({
                    count: formatInteger(activeHookCount),
                  })
                : m.modals_deleteWarning_hooksCancelled_many({
                    count: formatInteger(activeHookCount),
                  })}
            </p>
          {/if}
        </div>
      {/if}

      {#if workspaces.length > 0}
        <div role="list" class="max-h-56 w-full min-w-0 overflow-y-auto" use:scrollFade>
          {#each workspaces as workspace (workspace.id)}
            {@const statusState = resolveWorkspaceStatusState(workspace)}
            {@const statusPresentation = getWorkspaceStatusPresentation(statusState)}
            <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
            <div
              role="listitem"
              class="flex min-w-0 items-center gap-2.5 py-1.5 text-sm"
              onmouseenter={(event) => handleWorkspaceMouseEnter(workspace, event)}
              onmouseleave={() => handleWorkspaceMouseLeave(workspace)}
              style:anchor-name="--bulk-dialog-workspace-{workspace.id}"
            >
              <span class="shrink-0">
                <WorkspaceStatusIcon status={statusState} size={14} decorative />
                <span class="sr-only">{statusPresentation.accessibleName}</span>
              </span>
              <span class="min-w-0 flex-1 truncate">{workspace.title}</span>
              {#if workspace.status === WorkspaceStatusEnum.Archived}
                <span
                  class="shrink-0 rounded bg-foreground/[0.05] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground"
                >
                  {m.lib_commandPalette_archivedWorkspace_pill()}
                </span>
              {/if}
            </div>
          {/each}
        </div>
      {/if}
    </div>

    <Dialog.Footer class="mt-0 flex-row items-center justify-end border-0 px-5 pb-5 pt-0">
      <Button variant="ghost-light" onclick={close}>
        {m.modals_bulkActionConfirm_cancel_label()}
      </Button>
      <Button
        {variant}
        bind:ref={confirmButtonRef}
        class={confirmHasFocus ? 'ring-ring/50 ring-[3px]' : undefined}
        onfocus={() => (confirmHasFocus = true)}
        onblur={() => (confirmHasFocus = false)}
        onclick={handleConfirm}
      >
        {confirmText}
      </Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>

{#if hoverCardWorkspace && hoverCardAnchorElement}
  <HoverCard
    anchor="--bulk-dialog-workspace-{hoverCardWorkspace.id}"
    position="right"
    anchorElement={hoverCardAnchorElement}
    class="z-[var(--layer-tooltip)]! w-auto overflow-visible! rounded-lg border-0! bg-background! shadow-none!"
  >
    <WorkspaceHoverCard workspace={hoverCardWorkspace} />
  </HoverCard>
{/if}
