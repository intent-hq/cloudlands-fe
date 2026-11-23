const MAX_HTML_PREVIEW_BYTES = 1024 * 1024;
const PREVIEW_TIMEOUT_MS = 5_000;

export function requestHtmlFilePreview(source: string, onResult: (html: string | null) => void) {
  if (
    source.length > MAX_HTML_PREVIEW_BYTES ||
    new TextEncoder().encode(source).byteLength > MAX_HTML_PREVIEW_BYTES
  ) {
    onResult(null);
    return;
  }

  let worker: Worker;
  try {
    worker = new Worker(new URL('./html-file-preview.worker.ts', import.meta.url), {
      type: 'module',
    });
  } catch {
    onResult(null);
    return;
  }

  // A slow or failed parse falls back to source without retrying on the UI thread.
  let stopped = false;
  const timer = setTimeout(() => finish(null), PREVIEW_TIMEOUT_MS);
  function stop() {
    if (stopped) return;
    stopped = true;
    clearTimeout(timer);
    worker.terminate();
  }
  function finish(html: string | null) {
    if (stopped) return;
    stop();
    onResult(html);
  }
  worker.onmessage = ({ data }: MessageEvent<string | null>) => finish(data);
  worker.onerror = (event) => {
    event.preventDefault();
    finish(null);
  };
  worker.postMessage(source);
  return stop;
}
