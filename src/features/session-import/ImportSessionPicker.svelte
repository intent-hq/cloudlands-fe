<script lang="ts">
  import { onMount } from 'svelte';
  import { Button } from '$lib/components/ui/button';
  import * as Popover from '$lib/components/ui/popover';
  import { useDialogPortalTarget } from '$lib/components/ui/dialog';
  import { canPlaceBeside } from '$lib/components/ui/overlay-positioning';
  import { IsMobile } from '$lib/hooks/is-mobile.svelte.js';
  import { pushEscapeLayer } from '$lib/utils/escapeLayers';
  import { faXmark } from '$lib/icons/phosphor-icons';
  import Fa from 'svelte-fa';
  import { m } from '$shared/paraglide/messages.js';
  import { workspacePickerStyles } from '$lib/components/workspace/initializer/workspace-picker-styles';
  import ImportSessionList from './ImportSessionList.svelte';
  import {
    toSessionImportSelection,
    type ImportableSession,
    type SessionImportSelection,
  } from './importable-session';
  import { store as appStore } from '$store/renderer/store';
  import { importableSessionsRequested } from '$store/renderer/slices/importable-sessions/importable-sessions-slice';
  import {
    selectImportableSessionProviders,
    selectImportableSessions,
    selectImportableSessionsAvailable,
    selectImportableSessionsStatus,
  } from '$store/renderer/slices/importable-sessions/importable-sessions-selectors';
  import { cwdBasename } from './utils/session-import-match';

  /**
   * New Workspace → "Import a session". Hidden when the daemon predates
   * `agent.importableSessions.list` or has no sessions to offer. Picking a
   * session makes it the workspace's first agent instead of a new one.
   */
  interface Props {
    selected: SessionImportSelection | null;
    onSelect: (session: SessionImportSelection | null) => void;
    disabled?: boolean;
    providerLabel?: (provider: string) => string;
    /** Load the first page on mount (previews seed the store instead). */
    autoload?: boolean;
    /** Whether the session list is open (bindable; previews open it directly). */
    open?: boolean;
  }

  let {
    selected,
    onSelect,
    disabled = false,
    providerLabel,
    autoload = true,
    open = $bindable(false),
  }: Props = $props();

  const uid = $props.id();
  const labelId = `${uid}-import-session-label`;
  const valueId = `${uid}-import-session-value`;
  const dialogPortalTarget = useDialogPortalTarget();
  const isMobile = new IsMobile();
  const popoverWidth = 440;
  const sessions$ = selectImportableSessions();
  const status$ = selectImportableSessionsStatus();
  const available$ = selectImportableSessionsAvailable();
  const providers$ = selectImportableSessionProviders();
  let providerFilter = $state('');
  let menuBelow = $state(false);
  let trigger = $state<HTMLButtonElement | HTMLAnchorElement | null>(null);
  let searchInput = $state<HTMLInputElement | null>(null);
  let query = '';
  // The first page shows the loading row; a typed search keeps the rows,
  // filtered locally, until the daemon's matches arrive.
  const listStatus = $derived(
    $status$ === 'error' || $status$ === 'unsupported'
      ? 'error'
      : ($status$ === 'loading' || $status$ === 'idle') && $sessions$.length === 0
        ? 'loading'
        : 'ready',
  );

  function request(next: string, provider = providerFilter) {
    query = next;
    appStore.dispatch(importableSessionsRequested(next, provider || undefined));
  }

  function filterProvider(provider: string) {
    providerFilter = provider;
    request(query, provider);
  }

  onMount(() => {
    if (autoload) request('');
  });

  $effect(() => {
    if (!open) return;
    return pushEscapeLayer((event) => {
      if (!event.isComposing) open = false;
    });
  });

  function pick(session: ImportableSession) {
    onSelect(toSessionImportSelection(session));
    open = false;
  }

  const detail = $derived(
    selected ? [cwdBasename(selected.cwd), selected.gitBranch].filter(Boolean).join(' · ') : '',
  );
</script>

{#if $available$ || selected}
  <div class="w-full min-w-0" data-testid="import-session-picker">
    <div class="flex min-w-0 items-center gap-1">
      <Popover.Root
        bind:open
        onOpenChange={(next) => {
          if (next) {
            menuBelow = !canPlaceBeside(trigger, popoverWidth);
            if ($status$ === 'error' || query) request('');
          }
        }}
      >
        <Popover.Trigger>
          {#snippet child({ props })}
            <Button
              {...props}
              bind:ref={trigger}
              variant="ghost"
              size="sm"
              type="button"
              wrapContent={false}
              {disabled}
              aria-labelledby="{labelId} {valueId}"
              class="{workspacePickerStyles.fieldTrigger} flex-1"
              data-testid="import-session-trigger"
            >
              <span class={workspacePickerStyles.fieldLabel} id={labelId}
                >{m.sessionImport_picker_label()}</span
              >
              <span class="min-w-0 flex-1 text-left" id={valueId}>
                <span class="block truncate {selected ? '' : 'text-muted-foreground'}"
                  >{selected
                    ? selected.title.trim() || m.sessionImport_list_untitled_label()
                    : m.sessionImport_picker_none_label()}</span
                >
                {#if selected && detail}
                  <span
                    class="type-caption block truncate text-muted-foreground"
                    title={selected.cwd}>{detail}</span
                  >
                {/if}
              </span>
            </Button>
          {/snippet}
        </Popover.Trigger>
        <Popover.Content
          role="dialog"
          portalProps={{ to: dialogPortalTarget() }}
          aria-label={m.sessionImport_picker_label()}
          side={isMobile.current || menuBelow ? 'bottom' : 'left'}
          align={isMobile.current || menuBelow ? 'end' : 'start'}
          sideOffset={isMobile.current || menuBelow ? 4 : 24}
          strategy={dialogPortalTarget() ? 'absolute' : 'fixed'}
          preventScroll={false}
          class="flex min-h-0 w-110 max-w-[calc(100vw-1rem)] flex-col overflow-hidden p-0"
          style="max-height: min(480px, var(--bits-popover-content-available-height, calc(100dvh - 1rem)))"
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            searchInput?.focus();
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            trigger?.focus();
          }}
          onkeydown={(event) => {
            if (event.key === 'Enter') event.stopPropagation();
          }}
        >
          <ImportSessionList
            status={listStatus}
            sessions={$sessions$}
            {open}
            {providerLabel}
            providers={$providers$}
            {providerFilter}
            onproviderchange={filterProvider}
            bind:inputRef={searchInput}
            onquerychange={request}
            onselect={pick}
            onretry={() => request(query)}
            onclose={() => (open = false)}
          />
        </Popover.Content>
      </Popover.Root>
      {#if selected}
        <Button
          variant="ghost"
          size="icon-sm"
          type="button"
          {disabled}
          aria-label={m.sessionImport_picker_clear_ariaLabel()}
          onclick={() => onSelect(null)}
          data-testid="import-session-clear"
        >
          <Fa icon={faXmark} />
        </Button>
      {/if}
    </div>
    {#if selected}
      <p class="type-caption mt-1 text-muted-foreground" data-testid="import-session-note">
        {m.sessionImport_picker_note_description()}
      </p>
    {/if}
  </div>
{/if}
