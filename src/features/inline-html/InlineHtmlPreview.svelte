<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { Button } from '$lib/components/ui/button';
  import { Skeleton } from '$lib/components/ui/skeleton';
  import { Input } from '$lib/components/ui/input';
  import CodeBlock from '$lib/components/editor/CodeBlock.svelte';
  import { formatNumber } from '$lib/i18n/format';
  import * as m from '$shared/paraglide/messages.js';
  import {
    emptyInlineVisualRecord,
    INLINE_VISUAL_MAX_SCENARIOS,
    isInlineVisualSnapshot,
    type InlineVisualRecord,
    type InlineVisualSnapshot,
    type InlineVisualValue,
  } from './inline-visual-types';
  import {
    buildInlineHtmlDocument,
    INLINE_HTML_MAX_HEIGHT,
    INLINE_HTML_MAX_SCROLL_DELTA,
    INLINE_HTML_MIN_HEIGHT,
    readInlineHtmlTheme,
  } from './inline-html-document';

  let {
    source,
    isStreaming = false,
    isComplete = true,
    record,
    storageStatus = 'ready',
    onRecordChange,
    onUseConfiguration,
    onExport,
    onRetry,
    storageError,
    exportStatus,
    exportPath,
    exportError,
  }: {
    source: string;
    isStreaming?: boolean;
    isComplete?: boolean;
    record?: InlineVisualRecord;
    storageStatus?: 'loading' | 'ready' | 'saving' | 'error';
    onRecordChange?: (record: InlineVisualRecord) => void;
    onUseConfiguration?: (snapshot: InlineVisualSnapshot) => void;
    onExport?: (record: InlineVisualRecord) => void;
    onRetry?: () => void;
    storageError?: string;
    exportStatus?: 'saving' | 'saved' | 'error';
    exportPath?: string;
    exportError?: string;
  } = $props();

  let root: HTMLDivElement;
  let frame = $state<HTMLIFrameElement | undefined>();
  let mounted = $state(false);
  let showSource = $state(false);
  let reload = $state(0);
  let documentHtml = $state('');
  let channel = $state('');
  let ready = $state(false);
  let runtimeError = $state('');
  let contentHeight = $state(INLINE_HTML_MIN_HEIGHT);
  let heightLimit = $state(INLINE_HTML_MAX_HEIGHT);
  let localRecord = $state<InlineVisualRecord>(emptyInlineVisualRecord());
  let previousSource: string | undefined;
  let pendingRestore = $state<InlineVisualSnapshot | undefined>();
  let compare = $state(false);
  const saved = $derived(record ?? localRecord);
  const storageAvailable = $derived(
    storageStatus !== 'loading' && (storageStatus !== 'error' || Boolean(saved.current)),
  );
  const runnable = $derived(
    !isStreaming && isComplete && Boolean(source.trim()) && storageAvailable,
  );
  const height = $derived(Math.min(heightLimit, Math.max(INLINE_HTML_MIN_HEIGHT, contentHeight)));
  const status = $derived(
    isStreaming || storageStatus === 'loading'
      ? 'loading'
      : !isComplete
        ? 'incomplete'
        : !source.trim()
          ? 'empty'
          : runtimeError
            ? 'error'
            : ready
              ? 'ready'
              : 'loading',
  );
  const loading = $derived(
    isStreaming || storageStatus === 'loading' || (runnable && !ready && !runtimeError),
  );

  function updateRecord(next: InlineVisualRecord) {
    localRecord = next;
    onRecordChange?.(next);
  }

  function saveScenario() {
    if (!saved.current || saved.scenarios.length >= INLINE_VISUAL_MAX_SCENARIOS) return;
    updateRecord({
      ...saved,
      scenarios: [
        ...saved.scenarios,
        {
          id: crypto.randomUUID(),
          name: m.inlineHtml_preview_scenarioName_label({
            number: formatNumber(saved.scenarios.length + 1),
          }),
          snapshot: structuredClone(saved.current),
        },
      ],
    });
    compare = true;
  }

  function renameScenario(id: string, name: string) {
    const trimmed = name.trim().slice(0, 120);
    if (!trimmed) return;
    updateRecord({
      ...saved,
      scenarios: saved.scenarios.map((entry) =>
        entry.id === id ? { ...entry, name: trimmed } : entry,
      ),
    });
  }

  function restoreScenario(snapshot: InlineVisualSnapshot) {
    pendingRestore = structuredClone(snapshot);
    updateRecord({ ...saved, current: structuredClone(snapshot) });
    reload += 1;
  }

  function displayValue(value: InlineVisualValue): string {
    if (typeof value === 'number') return formatNumber(value);
    if (typeof value === 'string') return value;
    return JSON.stringify(value);
  }

  function sendTheme() {
    if (!frame?.contentWindow || !channel) return;
    frame.contentWindow.postMessage(
      {
        channel,
        type: 'theme',
        theme: readInlineHtmlTheme(root),
      },
      '*',
    );
  }

  function scrollChat(deltaY: number) {
    let container = root.parentElement;
    while (container) {
      const styles = getComputedStyle(container);
      const maximum = container.scrollHeight - container.clientHeight;
      if (/^(auto|scroll|overlay)$/.test(styles.overflowY) && maximum > 1) {
        if (deltaY < 0 ? container.scrollTop > 0 : container.scrollTop < maximum) {
          container.dispatchEvent(new WheelEvent('wheel', { deltaY, bubbles: true }));
          container.scrollTop += deltaY;
          return;
        }
        if (/^(contain|none)$/.test(styles.overscrollBehaviorY)) return;
      }
      container = container.parentElement;
    }
    window.scrollBy({ top: deltaY, behavior: 'instant' });
  }

  $effect(() => {
    if (!mounted) return;
    const currentSource = source;
    const canRun = runnable;
    void reload;
    untrack(() => {
      if (previousSource !== currentSource) {
        localRecord = emptyInlineVisualRecord();
        compare = false;
        pendingRestore = undefined;
        previousSource = currentSource;
      }
      ready = false;
      runtimeError = '';
      contentHeight = INLINE_HTML_MIN_HEIGHT;
      channel = crypto.randomUUID();
      documentHtml = canRun
        ? buildInlineHtmlDocument(
            currentSource,
            channel,
            readInlineHtmlTheme(root),
            m.inlineHtml_preview_frame_ariaLabel(),
            pendingRestore ?? saved.current,
          )
        : '';
      pendingRestore = undefined;
    });
  });

  onMount(() => {
    mounted = true;
    const onMessage = (event: MessageEvent) => {
      if (event.source !== frame?.contentWindow || event.origin !== 'null') return;
      const data = event.data;
      if (!data || typeof data !== 'object' || data.channel !== channel) return;
      if (
        data.type === 'resize' &&
        typeof data.height === 'number' &&
        Number.isFinite(data.height) &&
        data.height >= 0
      ) {
        contentHeight = Math.min(INLINE_HTML_MAX_HEIGHT, Math.ceil(data.height));
      } else if (data.type === 'ready') {
        ready = true;
        sendTheme();
      } else if (data.type === 'error' && typeof data.message === 'string') {
        runtimeError = data.message.slice(0, 300);
      } else if (data.type === 'snapshot' && runnable && isInlineVisualSnapshot(data.snapshot)) {
        updateRecord({ ...saved, current: data.snapshot });
      } else if (
        data.type === 'wheel' &&
        ready &&
        runnable &&
        !showSource &&
        !loading &&
        typeof data.deltaY === 'number' &&
        Number.isFinite(data.deltaY) &&
        data.deltaY !== 0 &&
        Math.abs(data.deltaY) <= INLINE_HTML_MAX_SCROLL_DELTA
      ) {
        scrollChat(data.deltaY);
      }
    };
    const resize = () => {
      heightLimit = Math.min(
        INLINE_HTML_MAX_HEIGHT,
        Math.max(160, Math.floor(window.innerHeight * 0.8)),
      );
    };
    const themeObserver = new MutationObserver(sendTheme);
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class', 'style', 'data-theme'],
    });
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    media.addEventListener('change', sendTheme);
    window.addEventListener('message', onMessage);
    window.addEventListener('resize', resize);
    resize();
    return () => {
      themeObserver.disconnect();
      media.removeEventListener('change', sendTheme);
      window.removeEventListener('message', onMessage);
      window.removeEventListener('resize', resize);
    };
  });
</script>

<div
  bind:this={root}
  data-inline-html
  data-inline-html-status={status}
  aria-busy={loading}
  class="my-3 min-w-0 overflow-hidden rounded-lg bg-background text-foreground"
>
  <div class="flex min-w-0 items-center justify-end gap-1 p-1">
    <Button
      variant="ghost"
      size="sm"
      active={showSource}
      aria-pressed={showSource}
      onclick={() => {
        showSource = !showSource;
      }}
    >
      {showSource ? m.inlineHtml_preview_preview_label() : m.inlineHtml_preview_source_label()}
    </Button>
    <Button
      variant="ghost"
      size="sm"
      disabled={!runnable}
      onclick={() => {
        reload += 1;
      }}
    >
      {m.inlineHtml_preview_reload_label()}
    </Button>
  </div>
  {#if storageStatus === 'error'}
    <div class="type-body flex items-center justify-between gap-3 px-4 py-2" role="status">
      <span class="text-danger">{m.inlineHtml_preview_state_error()}</span>
      {#if onRetry}
        <Button variant="ghost" size="sm" onclick={onRetry}>
          {m.inlineHtml_preview_retry_label()}
        </Button>
      {/if}
    </div>
    {#if storageError}
      <p class="type-caption m-0 break-words px-4 pb-2 text-muted-foreground">{storageError}</p>
    {/if}
  {/if}
  {#if loading}
    <p class="sr-only" role="status">
      {isStreaming ? m.inlineHtml_preview_building_label() : m.inlineHtml_preview_loading_label()}
    </p>
  {:else if !runnable}
    <p class="type-body m-0 px-4 py-3 text-muted-foreground" role="status">
      {!isComplete
        ? m.inlineHtml_preview_incomplete_description()
        : m.inlineHtml_preview_empty_description()}
    </p>
  {:else if runtimeError}
    <div class="type-body px-4 py-2 text-danger" role="status">
      <p class="m-0">{m.inlineHtml_preview_runtime_error()}</p>
      <p class="type-code m-0 break-words">{runtimeError}</p>
    </div>
  {/if}
  <div class="relative min-w-0">
    {#if runnable && documentHtml}
      <iframe
        bind:this={frame}
        title={m.inlineHtml_preview_frame_ariaLabel()}
        sandbox="allow-scripts"
        referrerpolicy="no-referrer"
        srcdoc={documentHtml}
        class="block w-full border-0"
        class:preview-hidden={showSource || loading}
        aria-hidden={showSource || loading}
        style:height={`${height}px`}
      ></iframe>
    {/if}
    {#if showSource}
      <CodeBlock code={source} language="html" noBorder noMargin maxHeight={heightLimit} />
    {:else if loading}
      <div class="space-y-4 p-4" aria-hidden="true">
        <div class="space-y-2">
          <Skeleton class="h-4 w-32 max-w-1/2" />
          <Skeleton class="h-3 w-2/3" />
        </div>
        <Skeleton class="aspect-video max-h-60 w-full rounded-lg" />
        <div class="flex items-center gap-4">
          <Skeleton class="h-3 w-16" />
          <Skeleton class="h-2 min-w-0 flex-1" />
          <Skeleton class="h-3 w-10" />
        </div>
      </div>
    {/if}
  </div>
  {#if saved.current && runnable}
    <div class="flex flex-wrap items-center gap-1 px-4 py-2" data-inline-visual-actions>
      {#if onUseConfiguration}
        <Button
          size="sm"
          disabled={!ready || Boolean(runtimeError)}
          onclick={() => saved.current && onUseConfiguration(saved.current)}
        >
          {m.inlineHtml_preview_useConfiguration_label()}
        </Button>
      {/if}
      <Button
        variant="ghost"
        size="sm"
        disabled={!ready ||
          Boolean(runtimeError) ||
          saved.scenarios.length >= INLINE_VISUAL_MAX_SCENARIOS}
        onclick={saveScenario}
      >
        {m.inlineHtml_preview_saveScenario_label()}
      </Button>
      {#if saved.scenarios.length}
        <Button
          variant="ghost"
          size="sm"
          active={compare}
          aria-expanded={compare}
          onclick={() => (compare = !compare)}
        >
          {m.inlineHtml_preview_compare_label()}
        </Button>
      {/if}
      {#if onExport}
        <Button
          variant="ghost"
          size="sm"
          disabled={!ready || exportStatus === 'saving'}
          onclick={() => onExport(saved)}
        >
          {m.inlineHtml_preview_export_label()}
        </Button>
      {/if}
      {#if onRecordChange}
        <span class="type-caption ml-auto text-muted-foreground" role="status">
          {storageStatus === 'saving'
            ? m.inlineHtml_preview_saving_label()
            : storageStatus === 'ready'
              ? m.inlineHtml_preview_saved_label()
              : ''}
        </span>
      {/if}
    </div>
    {#if exportStatus}
      <p class="type-caption m-0 break-words px-4 pb-2 text-muted-foreground" role="status">
        {exportStatus === 'saving'
          ? m.inlineHtml_preview_exporting_label()
          : exportStatus === 'saved'
            ? m.inlineHtml_preview_exported_description({ path: exportPath ?? '' })
            : m.inlineHtml_preview_export_error()}
        {#if exportStatus === 'error' && exportError}
          {exportError}
        {/if}
      </p>
    {/if}
    {#if compare && saved.scenarios.length}
      <div class="overflow-x-auto px-4 pb-4" data-inline-visual-comparison>
        <table class="type-body w-full border-separate border-spacing-0 text-left">
          <thead>
            <tr>
              <th class="min-w-28 pr-4 pb-3 font-normal text-muted-foreground">
                {saved.current.title}
              </th>
              <th class="min-w-32 px-2 pb-3 align-top font-medium">
                {m.inlineHtml_preview_current_label()}
              </th>
              {#each saved.scenarios as scenario (scenario.id)}
                <th class="min-w-40 px-2 pb-3 align-top font-normal">
                  <Input
                    value={scenario.name}
                    aria-label={m.inlineHtml_preview_scenarioName_ariaLabel()}
                    maxlength={120}
                    onblur={(event) => {
                      if (!event.currentTarget.value.trim())
                        event.currentTarget.value = scenario.name;
                      renameScenario(scenario.id, event.currentTarget.value);
                    }}
                    onkeydown={(event) => {
                      if (event.key === 'Enter') event.currentTarget.blur();
                      if (event.key === 'Escape') {
                        event.currentTarget.value = scenario.name;
                        event.currentTarget.blur();
                      }
                    }}
                  />
                  <div class="mt-1 flex gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      onclick={() => restoreScenario(scenario.snapshot)}
                      >{m.inlineHtml_preview_restore_label()}</Button
                    >
                    <Button
                      variant="ghost"
                      size="sm"
                      onclick={() =>
                        updateRecord({
                          ...saved,
                          scenarios: saved.scenarios.filter((item) => item.id !== scenario.id),
                        })}>{m.inlineHtml_preview_remove_label()}</Button
                    >
                  </div>
                </th>
              {/each}
            </tr>
          </thead>
          <tbody>
            {#each ['inputs', 'results'] as group}
              {@const fieldGroup = group as 'inputs' | 'results'}
              {@const fields = Array.from(
                new Set([
                  ...Object.keys(saved.current[fieldGroup]),
                  ...saved.scenarios.flatMap((entry) => Object.keys(entry.snapshot[fieldGroup])),
                ]),
              )}
              {#each fields as name (name)}
                <tr>
                  <th
                    class="max-w-48 py-2 pr-4 align-top font-normal break-words text-muted-foreground"
                  >
                    {name}
                  </th>
                  {#each [saved.current, ...saved.scenarios.map((entry) => entry.snapshot)] as snapshot}
                    <td class="max-w-56 px-2 py-2 align-top break-words tabular-nums">
                      {Object.hasOwn(snapshot[fieldGroup], name)
                        ? displayValue(snapshot[fieldGroup][name])
                        : '—'}
                    </td>
                  {/each}
                </tr>
              {/each}
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
  {/if}
</div>

<style>
  .preview-hidden {
    position: absolute;
    inset: 0 auto auto 0;
    visibility: hidden;
    pointer-events: none;
  }
</style>
