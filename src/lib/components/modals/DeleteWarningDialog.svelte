<script lang="ts">
  import { Button } from '$lib/components/ui/button';
  import Fa from 'svelte-fa';
  import {
    faExclamationTriangle,
    faXmark,
  } from '@fortawesome/free-solid-svg-icons';
  import Portal from '$lib/components/ui/Portal.svelte';
  import { m } from '$shared/paraglide/messages.js';
  import { formatInteger } from '$lib/i18n/format';

  interface Props {
    open?: boolean;
    /** 'delete' (default) warns before a permanent delete; 'archive' before an archive. */
    mode?: 'delete' | 'archive';
    agentNames?: string[];
    hookNames?: string[];
    onDeleteAnyway?: () => void;
    onCancel?: () => void;
  }

  let {
    open = $bindable(false),
    mode = 'delete',
    agentNames = [],
    hookNames = [],
    onDeleteAnyway,
    onCancel,
  }: Props = $props();

  // Mode-derived ids so the delete and archive hosts never collide in the DOM.
  const dialogTitleId = $derived(`${mode}-warning-dialog-title`);
  const dialogDescriptionId = $derived(`${mode}-warning-dialog-description`);

  const isArchive = $derived(mode === 'archive');
  const closeAriaLabel = $derived(
    isArchive ? m.modals_archiveWarning_close_ariaLabel() : m.modals_deleteWarning_close_ariaLabel()
  );

  function close() {
    open = false;
    onCancel?.();
  }

  function handleDeleteAnyway() {
    onDeleteAnyway?.();
    open = false;
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close();
    }
  }
</script>

{#if open}
  <Portal target="body" zIndex={100}>
    <div
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-[1px]"
      role="presentation"
      onkeydown={handleKeydown}
      onclick={close}
    >
      <div
        class="flex w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-border/80 bg-background shadow-xl shadow-black/20"
        onclick={(e) => e.stopPropagation()}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={dialogTitleId}
        aria-describedby={dialogDescriptionId}
        tabindex="-1"
        onkeydown={handleKeydown}
      >
        <div class="flex items-start justify-between gap-4 px-6 pt-6">
          <div class="flex items-start gap-4">
            <div
              class="mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-full bg-destructive text-destructive-foreground ring-1 ring-destructive-foreground/15 dark:bg-destructive/70"
            >
              <Fa icon={faExclamationTriangle} size="lg" />
            </div>
            <div>
              <h2 id={dialogTitleId} class="text-lg font-semibold leading-6">
                {isArchive ? m.modals_archiveWarning_title() : m.modals_deleteWarning_title()}
              </h2>
              <p class="mt-1 text-sm text-subtle">
                {isArchive
                  ? m.modals_archiveWarning_description()
                  : m.modals_deleteWarning_description()}
              </p>
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon-sm"
            class="-mr-1 mt-0.5 text-subtle hover:text-foreground"
            aria-label={closeAriaLabel}
            onclick={close}
          >
            <Fa icon={faXmark} />
          </Button>
        </div>

        <div id={dialogDescriptionId} class="space-y-4 px-6 py-5">
          <div class="rounded-xl border border-destructive-foreground/15 bg-destructive/45 p-4">
            {#if agentNames.length > 0}
              <p class="text-sm font-medium text-foreground">
                {agentNames.length === 1
                  ? m.modals_deleteWarning_agentsStopped_one({ count: formatInteger(agentNames.length) })
                  : m.modals_deleteWarning_agentsStopped_many({ count: formatInteger(agentNames.length) })}
              </p>
              <ul class="mt-3 max-h-32 space-y-2 overflow-auto pr-1">
                {#each agentNames as name}
                  <li class="flex items-center gap-2 text-sm text-subtle">
                    <span class="size-1.5 rounded-full bg-destructive-foreground"></span>
                    <span class="truncate">{name}</span>
                  </li>
                {/each}
              </ul>
            {/if}
            {#if hookNames.length > 0}
              <p
                class="text-sm font-medium text-foreground"
                class:mt-3={agentNames.length > 0}
              >
                {hookNames.length === 1
                  ? m.modals_deleteWarning_hooksCancelled_one({ count: formatInteger(hookNames.length) })
                  : m.modals_deleteWarning_hooksCancelled_many({ count: formatInteger(hookNames.length) })}
              </p>
              <ul class="mt-3 max-h-32 space-y-2 overflow-auto pr-1">
                {#each hookNames as name}
                  <li class="flex items-center gap-2 text-sm text-subtle">
                    <span class="size-1.5 rounded-full bg-destructive-foreground"></span>
                    <span class="truncate">{name}</span>
                  </li>
                {/each}
              </ul>
            {/if}
          </div>
          <p class="text-sm leading-6 text-subtle">
            {isArchive
              ? m.modals_archiveWarning_note_description()
              : m.modals_deleteWarning_permanent_description()}
          </p>
        </div>

        <div
          class="flex flex-col-reverse gap-2 border-t border-border/70 bg-muted/20 px-6 py-4 sm:flex-row sm:justify-end"
        >
          <Button variant="outline" onclick={close}>{m.modals_deleteWarning_cancel_label()}</Button>
          <Button variant="destructive" class="sm:min-w-[11rem]" onclick={handleDeleteAnyway}>
            {isArchive
              ? m.modals_archiveWarning_confirm_label()
              : m.modals_deleteWarning_confirm_label()}
          </Button>
        </div>
      </div>
    </div>
  </Portal>
{/if}
