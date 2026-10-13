<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { Button } from '$lib/components/ui/button';
  import { Skeleton } from '$lib/components/ui/skeleton';
  import CodeBlock from '$lib/components/editor/CodeBlock.svelte';
  import * as m from '$shared/paraglide/messages.js';
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
  }: {
    source: string;
    isStreaming?: boolean;
    isComplete?: boolean;
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
  const runnable = $derived(!isStreaming && isComplete && Boolean(source.trim()));
  const height = $derived(Math.min(heightLimit, Math.max(INLINE_HTML_MIN_HEIGHT, contentHeight)));
  const status = $derived(
    isStreaming
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
  const loading = $derived(isStreaming || (runnable && !ready && !runtimeError));

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
          )
        : '';
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
</div>

<style>
  .preview-hidden {
    position: absolute;
    inset: 0 auto auto 0;
    visibility: hidden;
    pointer-events: none;
  }
</style>
