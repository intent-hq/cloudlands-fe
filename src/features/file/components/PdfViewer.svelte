<script lang="ts">
  import type { PDFDocumentProxy, PDFDocumentLoadingTask, RenderTask } from 'pdfjs-dist';
  import { Button } from '$lib/components/ui/button';
  import { formatInteger, formatNumber } from '$lib/i18n/format';
  import { m } from '$shared/paraglide/messages.js';
  import { readPdf, PdfReadError } from '../services/read-pdf';

  let { workspaceId, filePath }: { workspaceId: string; filePath: string } = $props();
  let pdf = $state.raw<PDFDocumentProxy | null>(null);
  let canvas = $state<HTMLCanvasElement>();
  let pageNumber = $state(1);
  let scale = $state(1);
  let loading = $state(true);
  let rendering = $state(false);
  let error = $state<'missing' | 'large' | 'load' | 'invalid' | 'password' | null>(null);
  let retry = $state(0);
  const errorMessage = $derived(
    error === 'missing'
      ? m.file_pdf_missing_error()
      : error === 'large'
        ? m.file_pdf_large_error()
        : error === 'invalid'
          ? m.file_pdf_invalid_error()
          : error === 'password'
            ? m.file_pdf_password_error()
            : m.file_pdf_load_error(),
  );

  $effect(() => {
    const wsId = workspaceId;
    const path = filePath;
    void retry;
    const abort = new AbortController();
    let task: PDFDocumentLoadingTask | undefined;
    pdf = null;
    error = null;
    loading = true;
    pageNumber = 1;
    scale = 1;
    void (async () => {
      try {
        // eslint-disable-next-line intent/no-component-async-data-fetch -- View-owned binary rendering resource, transferred to PDF.js and destroyed on unmount; never shared Redux domain state.
        const bytes = await readPdf(wsId, path, abort.signal);
        const { loadPdfDocument } = await import('../services/pdf-renderer');
        if (abort.signal.aborted) return;
        task = loadPdfDocument(bytes);
        const document = await task.promise;
        if (!abort.signal.aborted) pdf = document;
      } catch (cause) {
        if (abort.signal.aborted) return;
        error =
          cause instanceof PdfReadError
            ? cause.reason
            : cause instanceof Error && cause.name === 'PasswordException'
              ? 'password'
              : cause instanceof Error && cause.name === 'InvalidPDFException'
                ? 'invalid'
                : 'load';
      } finally {
        if (!abort.signal.aborted) loading = false;
      }
    })();
    return () => {
      abort.abort();
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
    rendering = true;
    void (async () => {
      try {
        const page = await document.getPage(number);
        if (cancelled) return;
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
    };
  });
</script>

<div class="flex h-full min-h-0 flex-col" data-testid="pdf-viewer">
  {#if loading}
    <p role="status" class="m-auto text-subtle">{m.file_pdf_loading_label()}</p>
  {:else if error}
    <div class="m-auto flex flex-col items-center gap-3 p-4">
      <p role="alert">{errorMessage}</p>
      <Button variant="outline" onclick={() => retry++}>{m.ui_combobox_retry_label()}</Button>
    </div>
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
