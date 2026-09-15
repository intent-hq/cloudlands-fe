import { shouldReduceMotion } from '$lib/utils/motion-preference';
import type { PreviewCaptureReadiness } from './preview-definition';

const DEFAULT_CAPTURE_STABILITY_TIMEOUT_MS = 5_000;

export interface CaptureStabilityOptions {
  readiness?: PreviewCaptureReadiness;
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface CaptureStabilityLifecycle {
  onStable: (result: CaptureStabilityResult, generation: number) => void;
  onWaiting?: (generation: number) => void;
}

export interface CaptureStabilityResult {
  /** Images that gated readiness; deferred lazy images are excluded. */
  imageCount: number;
  /**
   * Incomplete `loading="lazy"` images skipped because they were unrendered or outside
   * the window viewport when readiness was evaluated. This describes their position, not
   * their network state: the browser may already be preloading images near the viewport.
   */
  deferredImageCount: number;
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

interface ReadinessMarker {
  element: Element;
  generation: string | null;
}

interface CaptureStabilitySnapshot {
  result: CaptureStabilityResult;
  markers: ReadinessMarker[] | null;
}

function readReadinessMarkers(
  root: HTMLElement,
  readiness: PreviewCaptureReadiness,
): ReadinessMarker[] | null {
  const elements = [
    ...(root.matches(readiness.selector) ? [root] : []),
    ...root.querySelectorAll(readiness.selector),
  ];
  if (readiness.count ? elements.length !== readiness.count : elements.length === 0) return null;
  const markers = elements.map((element) => ({
    element,
    generation: readiness.generationAttribute
      ? element.getAttribute(readiness.generationAttribute)
      : null,
  }));
  if (readiness.generationAttribute && markers.some(({ generation }) => generation === null)) {
    return null;
  }
  return markers;
}

function markersMatch(current: ReadinessMarker[] | null, expected: ReadinessMarker[]): boolean {
  return (
    current?.length === expected.length &&
    current.every(
      (marker, index) =>
        marker.element === expected[index].element &&
        marker.generation === expected[index].generation,
    )
  );
}

function waitForReadiness(
  root: HTMLElement,
  readiness: PreviewCaptureReadiness,
  signal?: AbortSignal,
): Promise<ReadinessMarker[]> {
  if (signal?.aborted) return Promise.reject(abortError());
  const current = readReadinessMarkers(root, readiness);
  if (current) return Promise.resolve(current);

  return new Promise<ReadinessMarker[]>((resolve, reject) => {
    const observer = new MutationObserver(() => {
      const markers = readReadinessMarkers(root, readiness);
      if (!markers) return;
      cleanup();
      resolve(markers);
    });
    const onAbort = () => {
      cleanup();
      reject(abortError());
    };
    const cleanup = () => {
      observer.disconnect();
      signal?.removeEventListener('abort', onAbort);
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    observer.observe(root, { attributes: true, childList: true, subtree: true });
  });
}

function waitForReadinessChange(
  root: HTMLElement,
  readiness: PreviewCaptureReadiness,
  markers: ReadinessMarker[],
  signal: AbortSignal,
): Promise<void> {
  if (signal.aborted) return Promise.reject(abortError());
  if (!markersMatch(readReadinessMarkers(root, readiness), markers)) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    const observer = new MutationObserver(() => {
      if (markersMatch(readReadinessMarkers(root, readiness), markers)) return;
      cleanup();
      resolve();
    });
    const onAbort = () => {
      cleanup();
      reject(abortError());
    };
    const cleanup = () => {
      observer.disconnect();
      signal.removeEventListener('abort', onAbort);
    };
    signal.addEventListener('abort', onAbort, { once: true });
    observer.observe(root, { attributes: true, childList: true, subtree: true });
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

// An unrendered element (`display: none` / `content-visibility: hidden` subtree) has a
// zero rect at the origin, which the viewport bounds check would otherwise accept.
function isRendered(image: HTMLImageElement): boolean {
  return typeof image.checkVisibility === 'function' ? image.checkVisibility() : true;
}

function intersectsViewport(image: HTMLImageElement): boolean {
  const view = image.ownerDocument.defaultView;
  if (!view) return true;
  const rect = image.getBoundingClientRect();
  return (
    rect.bottom >= 0 &&
    rect.right >= 0 &&
    rect.top <= view.innerHeight &&
    rect.left <= view.innerWidth
  );
}

/**
 * Viewport readiness semantics: an incomplete `loading="lazy"` image that is unrendered or
 * outside the window viewport cannot be relied on to complete without layout or scroll
 * changes, so it never gates readiness. Visible lazy images, complete images, and eager
 * images gate as before.
 */
function isDeferredLazyImage(image: HTMLImageElement): boolean {
  if (image.complete) return false;
  if ((image.getAttribute('loading') ?? '').toLowerCase() !== 'lazy') return false;
  return !isRendered(image) || !intersectsViewport(image);
}

interface ImageReadiness {
  imageCount: number;
  deferredImageCount: number;
}

async function waitForImages(root: HTMLElement, signal: AbortSignal): Promise<ImageReadiness> {
  const allImages = [...root.querySelectorAll('img')];
  const images = allImages.filter((image) => !isDeferredLazyImage(image));
  await Promise.all(images.map((image) => waitForImage(image, signal)));
  return {
    imageCount: images.length,
    deferredImageCount: allImages.length - images.length,
  };
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
 *
 * Image readiness uses viewport semantics: every eager image, every already-complete
 * image, and every rendered lazy image that intersects the window viewport must finish
 * loading and decoding, whether it succeeds or errors. Incomplete `loading="lazy"` images
 * that are unrendered or outside the viewport are skipped and reported in
 * `deferredImageCount`, because the browser defers fetching them until they approach the
 * viewport and waiting on them would only end at the timeout. This is a deliberate limit,
 * not a whole-scene guarantee: a capture that scrolls a target into view or renders a
 * frame extending beyond the viewport can still include an image that was skipped here.
 */
export async function waitForCaptureStability(
  root: HTMLElement,
  options: CaptureStabilityOptions = {},
): Promise<CaptureStabilityResult> {
  return (await waitForCaptureStabilitySnapshot(root, options)).result;
}

async function waitForCaptureStabilitySnapshot(
  root: HTMLElement,
  options: CaptureStabilityOptions,
): Promise<CaptureStabilitySnapshot> {
  while (true) {
    const readiness = options.readiness;
    const markers = readiness ? await waitForReadiness(root, readiness, options.signal) : null;
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
      const images = await waitForImages(root, controller.signal);
      await waitForAnimationFrame(documentRef, controller.signal);

      if (readiness && markers && !markersMatch(readReadinessMarkers(root, readiness), markers)) {
        continue;
      }
      return {
        result: { ...images, reducedMotion: shouldReduceMotion(documentRef) },
        markers,
      };
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
}

export async function watchCaptureStability(
  root: HTMLElement,
  options: CaptureStabilityOptions & { signal: AbortSignal },
  lifecycle: CaptureStabilityLifecycle,
): Promise<void> {
  let generation = 1;
  lifecycle.onWaiting?.(generation);
  while (!options.signal.aborted) {
    const { result, markers } = await waitForCaptureStabilitySnapshot(root, options);
    lifecycle.onStable(result, generation);
    if (!options.readiness || !markers) return;
    await waitForReadinessChange(root, options.readiness, markers, options.signal);
    generation += 1;
    lifecycle.onWaiting?.(generation);
  }
}
