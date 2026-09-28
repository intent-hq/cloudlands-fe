<script lang="ts">
  import type {
    PDFDocumentProxy,
    PDFDocumentLoadingTask,
    PDFPageProxy,
    RenderTask,
  } from 'pdfjs-dist';
  import { Button } from '$lib/components/ui/button';
  import { formatInteger, formatNumber } from '$lib/i18n/format';
  import { m } from '$shared/paraglide/messages.js';
  import { LoadingState, ErrorState } from '$lib/components/patterns/screen';
  import { store as appStore } from '$store/renderer/store';
  import { selectPdfPreview } from '$store/renderer/slices/pdf-preview/pdf-preview-selectors';
  import {
    pdfPreviewRequested,
    pdfPreviewReleased,
  } from '$store/renderer/slices/pdf-preview/pdf-preview-slice';

  let { workspaceId, filePath }: { workspaceId: string; filePath: string } = $props();
  const viewId = crypto.randomUUID();
  const preview = selectPdfPreview(viewId);
  const pageUsers = new WeakMap<PDFPageProxy, number>();
  let pdf = $state.raw<PDFDocumentProxy | null>(null);
  let canvas = $state<HTMLCanvasElement>();
  let pageNumber = $state(1);
  let scale = $state(1);
  let loading = $state(true);
  let rendering = $state(false);
  let error = $state<'missing' | 'large' | 'load' | 'invalid' | 'password' | null>(null);
  let retry = $state(0);
  const shownError = $derived($preview?.error ?? error);
  const errorMessage = $derived(
    shownError === 'missing'
      ? m.file_pdf_missing_error()
      : shownError === 'large'
        ? m.file_pdf_large_error()
        : shownError === 'invalid'
          ? m.file_pdf_invalid_error()
          : shownError === 'password'
            ? m.file_pdf_password_error()
            : m.file_pdf_load_error(),
  );

  $effect(() => {
    const wsId = workspaceId;
    const path = filePath;
    void retry;
    const requestId = crypto.randomUUID();
    appStore.dispatch(pdfPreviewRequested(viewId, requestId, wsId, path));
    return () => {
      appStore.dispatch(pdfPreviewReleased(viewId, requestId));
    };
  });

  $effect(() => {
    const url = $preview?.url;
    let cancelled = false;
    let task: PDFDocumentLoadingTask | undefined;
    pdf = null;
    error = null;
    loading = true;
    pageNumber = 1;
    scale = 1;
    if (!url) return;
    void (async () => {
      try {
        const { loadPdfDocument } = await import('../services/pdf-renderer');
        if (cancelled) return;
        task = loadPdfDocument(url);
        const document = await task.promise;
        if (!cancelled) pdf = document;
      } catch (cause) {
        if (cancelled) return;
        error =
          cause instanceof Error && cause.name === 'PasswordException'
            ? 'password'
            : cause instanceof Error && cause.name === 'InvalidPDFException'
              ? 'invalid'
              : 'load';
      } finally {
        if (!cancelled) loading = false;
      }
    })();
    return () => {
      cancelled = true;
      void task?.destroy();
    };
  });

  $effect(() => {
    const document = pdf;
    const target = canvas;
    const number = pageNumber;
    const zoom = scale;
    if (!document || !target) return;
    let cancelled = false;
    let renderTask: RenderTask | undefined;
    let page: PDFPageProxy | undefined;
    const releasePage = () => {
      if (!page) return;
      const remaining = (pageUsers.get(page) ?? 1) - 1;
      if (remaining) pageUsers.set(page, remaining);
      else {
        pageUsers.delete(page);
        page.cleanup();
      }
      page = undefined;
    };
    rendering = true;
    void (async () => {
      try {
        page = await document.getPage(number);
        // A zoom or late getPage may share PDF.js's cached proxy with a newer effect.
        pageUsers.set(page, (pageUsers.get(page) ?? 0) + 1);
        if (cancelled) {
          releasePage();
          return;
        }
        const viewport = page.getViewport({ scale: zoom });
        // Bound canvas memory for unusually large pages while keeping CSS zoom.
        const density = Math.min(
          window.devicePixelRatio || 1,
          2,
          Math.sqrt(16_000_000 / (viewport.width * viewport.height)),
        );
        target.width = Math.ceil(viewport.width * density);
        target.height = Math.ceil(viewport.height * density);
        target.style.width = `${viewport.width}px`;
        target.style.height = `${viewport.height}px`;
        renderTask = page.render({
          canvas: target,
          viewport,
          transform: [density, 0, 0, density, 0, 0],
        });
        await renderTask.promise;
      } catch {
        if (!cancelled) error = 'invalid';
      } finally {
        if (!cancelled) rendering = false;
      }
    })();
    return () => {
      cancelled = true;
      renderTask?.cancel();
      // PDF.js caches decoded images beyond render completion. Release the retired
      // page only after its render settles and no newer effect is using that proxy.
      if (renderTask) void renderTask.promise.then(releasePage, releasePage);
      else releasePage();
    };
  });
</script>

<div class="flex h-full min-h-0 flex-col" data-testid="pdf-viewer">
  {#if shownError}
    <ErrorState onRetry={() => retry++} retryLabel={m.ui_combobox_retry_label()} class="m-auto">
      {#snippet message()}{errorMessage}{/snippet}
    </ErrorState>
  {:else if loading || $preview?.status === 'loading'}
    <LoadingState label={m.file_pdf_loading_label()} count={1} class="p-4" />
  {:else if pdf}
    <div
      class="flex shrink-0 flex-wrap items-center justify-center gap-2 border-b border-border p-2"
    >
      <Button
        variant="ghost"
        size="compact"
        disabled={pageNumber <= 1}
        onclick={() => pageNumber--}
      >
        {m.file_pdf_previous_label()}
      </Button>
      <span aria-live="polite"
        >{m.file_pdf_page_label({
          page: formatInteger(pageNumber),
          total: formatInteger(pdf.numPages),
        })}</span
      >
      <Button
        variant="ghost"
        size="compact"
        disabled={pageNumber >= pdf.numPages}
        onclick={() => pageNumber++}
      >
        {m.file_pdf_next_label()}
      </Button>
      <Button
        variant="ghost"
        size="compact"
        disabled={scale <= 0.25}
        onclick={() => (scale = Math.max(0.25, scale - 0.25))}
      >
        {m.editor_fileViewer_zoomOut_tooltip()}
      </Button>
      <span>{formatNumber(scale, { style: 'percent' })}</span>
      <Button
        variant="ghost"
        size="compact"
        disabled={scale >= 3}
        onclick={() => (scale = Math.min(3, scale + 0.25))}
      >
        {m.editor_fileViewer_zoomIn_tooltip()}
      </Button>
    </div>
    <div class="min-h-0 flex-1 overflow-auto p-4" aria-busy={rendering}>
      <!-- svelte-ignore a11y_no_interactive_element_to_noninteractive_role (read-only rendered document image) -->
      <canvas
        bind:this={canvas}
        class="mx-auto block"
        style:visibility={rendering ? 'hidden' : 'visible'}
        role="img"
        aria-label={m.file_pdf_canvas_ariaLabel({
          name: filePath,
          page: formatInteger(pageNumber),
        })}
      ></canvas>
    </div>
  {/if}
</div>
