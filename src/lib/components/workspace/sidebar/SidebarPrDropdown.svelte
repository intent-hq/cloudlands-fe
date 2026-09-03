<script lang="ts">
  import Fa from 'svelte-fa';
  import { Button } from '$lib/components/ui/button';
  import DropdownMenu from '$lib/components/ui/dropdown-menu.svelte';
  import { handleLink } from '$features/navigation/link-handler';
  import { WorkspaceId } from '$shared/types/branded-ids';
  import { formatInteger } from '$lib/i18n/format';
  import { m } from '$shared/paraglide/messages.js';
  import SidebarPrList from './SidebarPrList.svelte';
  import type { WorkspacePRPresentationRow } from './workspace-pr-presentation';

  let {
    rows,
    workspaceId,
    side = 'top',
    align = 'end',
    class: className = '',
  }: {
    rows: WorkspacePRPresentationRow[];
    workspaceId: string;
    side?: 'top' | 'bottom' | 'left' | 'right';
    align?: 'start' | 'center' | 'end';
    class?: string;
  } = $props();

  let open = $state(false);

  // Rows arrive sorted by status priority (open → draft → merged → closed);
  // the lead row drives the trigger glyph.
  const leadRow = $derived(rows[0]);
  const triggerLabel = $derived(
    m.workspace_sidebarPrDropdown_trigger_ariaLabel({ count: formatInteger(rows.length) }),
  );

  function openPr(pr: WorkspacePRPresentationRow, close: () => void) {
    close();
    if (!pr.url) return;
    handleLink(pr.url, { workspaceId: WorkspaceId(workspaceId) });
  }
</script>

{#if leadRow}
  <!-- Click/pointer isolation only: the launcher card behind this control expands
       the Changes tab on click, so events must not bubble past the dropdown. -->
  <!-- svelte-ignore a11y_no_static_element_interactions a11y_click_events_have_key_events -->
  <span
    class="pointer-events-auto relative z-20 inline-flex {className}"
    data-sidebar-pr-dropdown
    onpointerdown={(event) => event.stopPropagation()}
    onclick={(event) => event.stopPropagation()}
  >
    <DropdownMenu
      bind:open
      {side}
      {align}
      contentMaxHeight="min(var(--bits-dropdown-menu-content-available-height, 100dvh), 22rem)"
    >
      {#snippet trigger({ props })}
        <Button
          {...props}
          variant="plain"
          size="icon"
          class="relative size-6 shrink-0 cursor-pointer rounded text-muted-foreground transition-colors hover:bg-background/70 hover:text-foreground focus-visible:bg-background/80 focus-visible:text-foreground"
          aria-label={triggerLabel}
          title={triggerLabel}
          data-sidebar-pr-trigger
          data-sidebar-pr-count={rows.length}
        >
          <Fa icon={leadRow.statusIcon} class="size-4! {leadRow.foregroundClass}" />
          {#if rows.length > 1}
            <span
              class="absolute -right-1 -top-1 min-w-3.5 rounded-full bg-muted px-1 text-center text-[9px] leading-[14px] font-semibold tabular-nums text-foreground ring-1 ring-background /* a11y-ignore: product requires a 9px count badge */"
              aria-hidden="true"
              data-sidebar-pr-count-badge>{formatInteger(rows.length)}</span
            >
          {/if}
        </Button>
      {/snippet}

      {#snippet content({ close })}
        <SidebarPrList {rows} onSelect={(pr) => openPr(pr, close)} />
      {/snippet}
    </DropdownMenu>
  </span>
{/if}
