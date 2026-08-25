const DEFAULT_CAPTURE_STABILITY_TIMEOUT_MS = 5_000;

export interface CaptureStabilityOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface CaptureStabilityResult {
  imageCount: number;
  reducedMotion: boolean;
}

export class CaptureStabilityTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Preview did not become stable within ${timeoutMs}ms.`);
    this.name = 'CaptureStabilityTimeoutError';
  }
}

function abortError(): DOMException {
  return new DOMException('Capture stability wait was cancelled.', 'AbortError');
}

function raceWithAbort<T>(promise: PromiseLike<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(abortError());
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      cleanup();
      reject(abortError());
    };
    const cleanup = () => signal.removeEventListener('abort', onAbort);
    signal.addEventListener('abort', onAbort, { once: true });
    void Promise.resolve(promise).then(
      (value) => {
        cleanup();
        resolve(value);
      },
      (error: unknown) => {
        cleanup();
        reject(error);
      },
    );
  });
}

async function waitForImage(image: HTMLImageElement, signal: AbortSignal): Promise<void> {
  if (!image.complete) {
    await new Promise<void>((resolve, reject) => {
      const finish = () => {
        cleanup();
        resolve();
      };
      const onAbort = () => {
        cleanup();
        reject(abortError());
      };
      const cleanup = () => {
        image.removeEventListener('load', finish);
        image.removeEventListener('error', finish);
        signal.removeEventListener('abort', onAbort);
      };
      image.addEventListener('load', finish, { once: true });
      image.addEventListener('error', finish, { once: true });
      signal.addEventListener('abort', onAbort, { once: true });
      if (signal.aborted) onAbort();
    });
  }

  if (image.naturalWidth > 0 && typeof image.decode === 'function') {
    await raceWithAbort(
      image.decode().catch(() => undefined),
      signal,
    );
  }
}

async function waitForImages(root: HTMLElement, signal: AbortSignal): Promise<number> {
  const images = [...root.querySelectorAll('img')];
  await Promise.all(images.map((image) => waitForImage(image, signal)));
  return images.length;
}

function waitForAnimationFrame(documentRef: Document, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(abortError());
  const view = documentRef.defaultView;
  return new Promise<void>((resolve, reject) => {
    let frameId: number | undefined;
    let timerId: ReturnType<typeof setTimeout> | undefined;
    const finish = () => {
      cleanup();
      resolve();
    };
    const onAbort = () => {
      cleanup();
      reject(abortError());
    };
    const cleanup = () => {
      if (frameId !== undefined) view?.cancelAnimationFrame?.(frameId);
      if (timerId !== undefined) clearTimeout(timerId);
      signal.removeEventListener('abort', onAbort);
    };
    signal.addEventListener('abort', onAbort, { once: true });
    if (view?.requestAnimationFrame) frameId = view.requestAnimationFrame(finish);
    else timerId = setTimeout(finish, 0);
  });
}

/**
 * Wait for capture-affecting fonts and images, then allow two animation frames for
 * reduced-motion styles and layout to settle. The wait always ends at the timeout
 * or when its signal is aborted.
 */
export async function waitForCaptureStability(
  root: HTMLElement,
  options: CaptureStabilityOptions = {},
): Promise<CaptureStabilityResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_CAPTURE_STABILITY_TIMEOUT_MS;
  const controller = new AbortController();
  let timedOut = false;
  const onAbort = () => controller.abort();
  options.signal?.addEventListener('abort', onAbort, { once: true });
  if (options.signal?.aborted) controller.abort();
  const timeoutId = setTimeout(
    () => {
      timedOut = true;
      controller.abort();
    },
    Math.max(0, timeoutMs),
  );

  try {
    const documentRef = root.ownerDocument;
    const fontsReady = documentRef.fonts?.ready ?? Promise.resolve();
    await Promise.all([
      raceWithAbort(fontsReady, controller.signal),
      waitForImages(root, controller.signal),
    ]);
    await waitForAnimationFrame(documentRef, controller.signal);
    const imageCount = await waitForImages(root, controller.signal);
    await waitForAnimationFrame(documentRef, controller.signal);

    const reducedMotion =
      documentRef.documentElement.classList.contains('catalog-reduced-motion') ||
      documentRef.defaultView?.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
    return { imageCount, reducedMotion };
  } catch (error) {
    if (timedOut) throw new CaptureStabilityTimeoutError(timeoutMs);
    if (options.signal?.aborted) throw abortError();
    throw error;
  } finally {
    clearTimeout(timeoutId);
    options.signal?.removeEventListener('abort', onAbort);
    controller.abort();
  }
}
