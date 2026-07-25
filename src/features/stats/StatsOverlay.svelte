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
  import { fade } from 'svelte/transition';
  import Fa from 'svelte-fa';
  import { faChevronDown, faCheck, faDownload, faXmark } from '@fortawesome/free-solid-svg-icons';
  import AgentPassportCard from './AgentPassportCard.svelte';
  import ModelsCard from './ModelsCard.svelte';
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
      const { toast } = await import('svelte-sonner');
      toast.error('PNG export failed', {
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
    transition:fade={{ duration: 150 }}
    onclick={close}
    aria-hidden="true"
  ></div>

  <div
    class="fixed inset-0 z-50 flex flex-col items-center overflow-y-auto px-8 pt-[61px] pb-12 pointer-events-none"
    role="dialog"
    aria-modal="true"
    aria-label="Usage stats"
    transition:fade={{ duration: 150 }}
  >
    <!-- Close affordance -->
    <button
      class="stats-close pointer-events-auto fixed top-10 right-5 z-10 flex h-8 w-8 items-center justify-center rounded-lg cursor-pointer"
      onclick={close}
      aria-label="Close usage stats"
    >
      <Fa icon={faXmark} size={14} />
    </button>

    <!-- Mode pill + period dropdown -->
    <div class="pointer-events-auto relative z-[3] flex items-center gap-2.5">
      <div class="stats-pill flex rounded-lg p-[3px]">
        {#each STATS_MODES as entry (entry.mode)}
          <button
            class="stats-pill-seg rounded-md px-3.5 py-[5px] text-[12.5px] font-medium cursor-pointer select-none {$mode$ ===
            entry.mode
              ? 'stats-pill-seg-active'
              : ''}"
            onclick={() => setMode(entry.mode)}
          >
            {entry.label}
          </button>
        {/each}
      </div>

      {#if $mode$ !== '24h'}
        <div class="relative">
          <button
            class="stats-dd-trigger flex h-8 items-center gap-2 rounded-lg px-3 text-[12.5px] font-medium cursor-pointer select-none"
            onclick={() => (dropdownOpen = !dropdownOpen)}
            aria-haspopup="listbox"
            aria-expanded={dropdownOpen}
          >
            {$periodKey$ ? periodLabel($mode$, $periodKey$) : '—'}
            <span class="opacity-60 text-[9px] a11y-ignore"
              ><Fa icon={faChevronDown} size={9} /></span
            >
          </button>
          {#if dropdownOpen}
            <div
              class="stats-dd absolute top-[38px] left-0 z-[4] w-40 rounded-lg p-1"
              role="listbox"
            >
              {#each options as key (key)}
                <button
                  class="stats-dd-opt flex w-full items-center justify-between rounded-[5px] px-[9px] py-1.5 text-xs cursor-pointer select-none {key ===
                  $periodKey$
                    ? 'stats-dd-opt-sel'
                    : ''}"
                  role="option"
                  aria-selected={key === $periodKey$}
                  onclick={() => pickPeriod(key)}
                >
                  {periodLabel($mode$, key)}
                  {#if key === $periodKey$}
                    <span class="stats-check"><Fa icon={faCheck} size={9} /></span>
                  {/if}
                </button>
              {:else}
                <div class="px-[9px] py-1.5 text-xs stats-muted">No data yet</div>
              {/each}
            </div>
          {/if}
        </div>
      {/if}
    </div>

    {#if $error$}
      <div class="stats-error pointer-events-auto mt-8 text-sm" role="alert">{$error$}</div>
    {/if}

    <!-- Card slots (each wrapped for the hover-reveal PNG export button) -->
    <div class="pointer-events-auto mt-[30px] flex flex-wrap justify-center gap-7">
      <div class="stats-card-wrap relative">
        {@render exportBtn('passport')}
        <AgentPassportCard data={$data$} label={cardLabel} />
      </div>
      <div class="stats-card-wrap relative">
        {@render exportBtn('models')}
        <ModelsCard data={$data$} label={cardLabel} />
      </div>
      <div class="stats-card-wrap relative">
        {@render exportBtn('by-hour')}
        <TokensByHourCard data={$data$} mode={$mode$} label={cardLabel} loading={$loading$} />
      </div>
      {#if $mode$ !== '24h'}
        <!-- Tokens by Month is hidden in 24H mode (Spec D11). -->
        <div class="stats-card-wrap relative">
          {@render exportBtn('by-month')}
          <TokensByMonthCard data={$data$} {yearKey} loading={$loading$} />
        </div>
      {/if}
    </div>

    <div class="stats-hint mt-[26px] text-xs">
      Hover a card to export it as a 1080×1920 PNG story.
    </div>
  </div>
{/if}

{#snippet exportBtn(card: StatsCardName)}
  <button
    class="stats-export-btn absolute top-3.5 right-3.5 z-[2] flex h-[30px] items-center gap-1.5 rounded-lg px-3 text-xs font-medium cursor-pointer"
    onclick={(event) => exportCard(event.currentTarget, card)}
    aria-label="Export {card} card as PNG"
  >
    <Fa icon={faDownload} size={11} /> PNG
  </button>
{/snippet}

<style>
  .stats-backdrop {
    background: rgba(0, 0, 0, 0.55);
    backdrop-filter: blur(6px);
    -webkit-backdrop-filter: blur(6px);
  }

  .stats-pill,
  .stats-dd-trigger,
  .stats-dd {
    background: hsl(240 12% 11%);
    border: 1px solid hsl(256 6% 24%);
  }

  .stats-pill,
  .stats-dd-trigger {
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
  }

  .stats-dd {
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
  }

  .stats-pill-seg {
    background: transparent;
    color: hsl(240 5% 58%);
  }

  .stats-pill-seg-active {
    background: hsl(240 12% 20%);
    color: hsl(0 0% 97%);
  }

  .stats-dd-trigger {
    color: hsl(0 0% 97%);
  }

  .stats-dd-opt {
    background: transparent;
    color: hsl(240 5% 58%);
  }

  .stats-dd-opt-sel {
    background: hsl(240 12% 18%);
    color: hsl(0 0% 97%);
  }

  .stats-check {
    color: hsl(158 100% 38%);
  }

  .stats-close {
    background: hsl(240 12% 11%);
    border: 1px solid hsl(256 6% 24%);
    color: hsl(0 0% 97%);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
  }

  .stats-muted {
    color: hsl(240 5% 46%);
  }

  .stats-hint {
    color: hsl(240 5% 46%);
  }

  .stats-error {
    color: hsl(0 84% 60%);
  }

  /* Design btn(): hover-only, top-right, semi-opaque dark chip. */
  .stats-export-btn {
    background: rgba(22, 22, 30, 0.9);
    border: 1px solid hsl(256 6% 32%);
    color: hsl(0 0% 97%);
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.15s;
  }

  .stats-card-wrap:hover .stats-export-btn,
  .stats-export-btn:focus-visible {
    opacity: 1;
    pointer-events: auto;
  }
</style>
