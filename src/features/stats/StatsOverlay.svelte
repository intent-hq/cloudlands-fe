<script lang="ts">
  /**
   * Usage Stats Overlay
   *
   * Full-screen overlay (blurs + dims the app behind) showing agentic usage
   * stats fetched via `stats.getUsage`. Header: 24H · Month · Year mode pill
   * plus a period dropdown (hidden in 24H mode — Spec D11). Card bodies are
   * placeholder slots filled in by follow-up tasks.
   *
   * The wire call lives in the stats read-service middleware; this component
   * only dispatches `loadUsageStatsRequested` and reads the `stats` slice.
   */
  import { fade } from '$lib/motion';
  import { Button } from '$lib/components/ui/button';
  import { menuItem } from '$lib/components/ui/menu';
  import { cn } from '$lib/utils';
  import Fa from 'svelte-fa';
  import { faChevronDown, faCheck, faDownload, faXmark } from '@fortawesome/free-solid-svg-icons';
  import AgentPassportCard from './AgentPassportCard.svelte';
  import ModelsCard from './ModelsCard.svelte';
  import ProvidersCard from './ProvidersCard.svelte';
  import TokensByHourCard from './TokensByHourCard.svelte';
  import TokensByMonthCard from './TokensByMonthCard.svelte';
  import {
    STATS_MODES,
    defaultPeriodKey,
    localTzOffsetMinutes,
    periodLabel,
    periodOptions,
    shortLabel,
    type StatsMode,
  } from './stats-period';
  import { selectStatsOverlayOpen } from '$store/renderer/slices/sidebar-nav/sidebar-nav-selectors';
  import { setStatsOverlayOpen } from '$store/renderer/slices/sidebar-nav/sidebar-nav-slice';
  import {
    selectStatsData,
    selectStatsError,
    selectStatsLoading,
    selectStatsMode,
    selectStatsPeriodKey,
  } from '$store/renderer/slices/stats/stats-selectors';
  import { loadUsageStatsRequested } from '$store/renderer/slices/stats/stats-slice';
  import { store as appStore } from '$store/renderer/store';
  import { m } from '$shared/paraglide/messages.js';
  import {
    exportCardPng,
    exportFileName,
    exportPeriodKey,
    type StatsCardName,
  } from './stats-export';

  const isOpen$ = selectStatsOverlayOpen();
  const mode$ = selectStatsMode();
  const periodKey$ = selectStatsPeriodKey();
  const loading$ = selectStatsLoading();
  const error$ = selectStatsError();
  const data$ = selectStatsData();

  let dropdownOpen = $state(false);

  const available = $derived($data$?.availablePeriods ?? { months: [], years: [] });
  const options = $derived(periodOptions($mode$, available));
  const cardLabel = $derived(shortLabel($mode$, $periodKey$ ?? ''));
  // "YYYY" of the selected period — the byMonth cells always span that year.
  const yearKey = $derived(($periodKey$ ?? '').slice(0, 4));

  function load(mode: StatsMode, key: string | undefined) {
    appStore.dispatch(loadUsageStatsRequested(mode, key ?? null, localTzOffsetMinutes()));
  }

  function setMode(nextMode: StatsMode) {
    dropdownOpen = false;
    load(nextMode, defaultPeriodKey(nextMode, available));
  }

  function pickPeriod(key: string) {
    dropdownOpen = false;
    load($mode$, key);
  }

  function close() {
    appStore.dispatch(setStatsOverlayOpen(false));
  }

  // Initial fetch each time the overlay opens (default = current month).
  let wasOpen = false;
  $effect(() => {
    const open = $isOpen$;
    if (open && !wasOpen) {
      dropdownOpen = false;
      load('month', defaultPeriodKey('month', { months: [], years: [] }));
    }
    wasOpen = open;
  });

  function handleKeydown(event: KeyboardEvent) {
    if (!$isOpen$) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      if (dropdownOpen) {
        dropdownOpen = false;
      } else {
        close();
      }
    }
  }

  // Hover-to-export PNG (1080×1920). Failure is surfaced non-fatally via a
  // toast + console — the overlay never crashes on a render error.
  async function exportCard(button: HTMLElement, card: StatsCardName) {
    const node = button.parentElement?.querySelector<HTMLElement>('[data-stats-card]');
    if (!node) return;
    const fileName = exportFileName(card, exportPeriodKey($mode$, $periodKey$));
    try {
      await exportCardPng(node, fileName);
    } catch (error) {
      console.error('stats PNG export failed', error);
      const { notify } = await import('$lib/components/patterns/notify');
      notify.error(m.stats_overlay_exportFailed_error(), {
        description: error instanceof Error ? error.message : String(error),
      });
    }
  }
</script>

<svelte:window onkeydown={handleKeydown} />

{#if $isOpen$}
  <!-- Backdrop: blur + dim the real app behind (design shows it at ~.22 opacity) -->
  <div
    class="stats-backdrop fixed inset-0 z-50"
    transition:fade={{ tier: 'moderate' }}
    onclick={close}
    aria-hidden="true"
  ></div>

  <div
    class="fixed inset-0 z-50 flex flex-col items-center overflow-y-auto px-8 py-12 pointer-events-none"
    role="dialog"
    aria-modal="true"
    aria-label={m.stats_overlay_dialog_ariaLabel()}
    transition:fade={{ tier: 'moderate' }}
  >
    <!-- Close affordance -->
    <Button
      variant="secondary"
      size="icon"
      iconOnly
      class="pointer-events-auto fixed top-3 right-3 z-10"
      onclick={close}
      aria-label={m.stats_overlay_close_ariaLabel()}
    >
      <Fa icon={faXmark} size={14} />
    </Button>

    <!-- Mode pill + period dropdown. The mt-auto here pairs with the hint's mb-auto to
         center the content block when it fits the viewport, without the top-clipping
         that justify-center causes on an overflow-y-auto container. -->
    <div
      class="pointer-events-auto relative z-[3] mt-auto flex flex-wrap justify-center items-center gap-2.5"
    >
      <div class="flex gap-1 rounded-lg bg-popover p-1 text-popover-foreground shadow-sm">
        {#each STATS_MODES as entry (entry.mode)}
          <Button
            variant={$mode$ === entry.mode ? 'secondary' : 'ghost'}
            size="sm"
            aria-pressed={$mode$ === entry.mode}
            onclick={() => setMode(entry.mode)}
          >
            {entry.label}
          </Button>
        {/each}
      </div>

      {#if $mode$ !== '24h'}
        <div class="relative">
          <Button
            variant="secondary"
            size="sm"
            onclick={() => (dropdownOpen = !dropdownOpen)}
            aria-haspopup="listbox"
            aria-expanded={dropdownOpen}
          >
            {$periodKey$ ? periodLabel($mode$, $periodKey$) : '—'}
            <span class="opacity-60 text-[9px] a11y-ignore"
              ><Fa icon={faChevronDown} size={9} /></span
            >
          </Button>
          {#if dropdownOpen}
            <div
              class="absolute top-full mt-1 left-0 z-[4] w-40 rounded-lg border border-border bg-popover text-popover-foreground p-1 shadow-md"
              role="listbox"
            >
              {#each options as key (key)}
                <Button
                  variant="ghost"
                  class={cn(menuItem(), 'justify-between', key === $periodKey$ && 'bg-muted')}
                  role="option"
                  aria-selected={key === $periodKey$}
                  onclick={() => pickPeriod(key)}
                >
                  {periodLabel($mode$, key)}
                  {#if key === $periodKey$}
                    <span><Fa icon={faCheck} size={9} /></span>
                  {/if}
                </Button>
              {:else}
                <div class="px-2 py-1.5 type-caption text-muted-foreground">
                  {m.stats_overlay_noData_label()}
                </div>
              {/each}
            </div>
          {/if}
        </div>
      {/if}
    </div>

    {#if $error$}
      <div
        class="pointer-events-auto mt-8 rounded-lg bg-popover p-3 text-sm text-danger"
        role="alert"
      >
        {$error$}
      </div>
    {/if}

    {#if $loading$ && !$data$}
      <p class="mt-8 rounded-lg bg-popover p-3 text-sm text-popover-foreground" role="status">
        {m.stats_overlay_loading_label()}
      </p>
    {/if}

    <!-- Card slots (each wrapped for the hover-reveal PNG export button) -->
    {#if $data$}
      <div class="pointer-events-auto mt-[30px] flex flex-wrap justify-center gap-7">
        <div class="group relative">
          {@render exportBtn('passport')}
          <AgentPassportCard data={$data$} label={cardLabel} />
        </div>
        <div class="group relative">
          {@render exportBtn('models')}
          <ModelsCard data={$data$} label={cardLabel} />
        </div>
        <div class="group relative">
          {@render exportBtn('providers')}
          <ProvidersCard data={$data$} label={cardLabel} />
        </div>
        <div class="group relative">
          {@render exportBtn('by-hour')}
          <TokensByHourCard data={$data$} mode={$mode$} label={cardLabel} loading={$loading$} />
        </div>
        {#if $mode$ !== '24h'}
          <!-- Tokens by Month is hidden in 24H mode (Spec D11). -->
          <div class="group relative">
            {@render exportBtn('by-month')}
            <TokensByMonthCard data={$data$} {yearKey} loading={$loading$} />
          </div>
        {/if}
      </div>

      <div
        class="mt-[26px] mb-auto rounded-full border border-border bg-popover text-muted-foreground px-3.5 py-1.5 text-xs"
      >
        {m.stats_overlay_exportHint_label()}
      </div>
    {:else}
      <div class="mb-auto"></div>
    {/if}
  </div>
{/if}

{#snippet exportBtn(card: StatsCardName)}
  <Button
    variant="secondary"
    size="sm"
    class="absolute top-3.5 right-3.5 z-[2] opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto focus-visible:opacity-100 focus-visible:pointer-events-auto"
    onclick={(event) => exportCard(event.currentTarget as HTMLElement, card)}
    aria-label={m.stats_overlay_exportCard_ariaLabel({ card })}
  >
    <Fa icon={faDownload} size={11} />
    {m.stats_overlay_png_label()}
  </Button>
{/snippet}

<style>
  .stats-backdrop {
    background: rgba(0, 0, 0, 0.55);
    backdrop-filter: blur(6px);
    -webkit-backdrop-filter: blur(6px);
  }
</style>
