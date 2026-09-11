import type { Component } from 'svelte';
import type { CatalogPreviewFit } from './catalog-preferences';
import {
  collectGeometry,
  type GeometryProbeOptions,
  type GeometryProbeResult,
} from './geometry-probe';
import {
  validatePreviewDefinition,
  type LoadedPreview,
  type PreviewDefinition,
} from './preview-definition';

type PreviewModule = {
  default: Component<Record<string, unknown>>;
  preview: PreviewDefinition<Record<string, unknown>>;
};

const previewLoaders = import.meta.glob(['/src/**/*.preview.ts', '/src/**/*.preview.svelte']);

type PreviewLoader = () => Promise<unknown>;

function slugFromPath(path: string): string | undefined {
  return path.match(/\/([^/]+)\.preview\.(?:ts|svelte)$/)?.[1];
}

export function createPreviewLoaderIndex(
  entries: Iterable<readonly [string, PreviewLoader]>,
): Map<string, PreviewLoader> {
  const index = new Map<string, PreviewLoader>();
  const pathsBySlug = new Map<string, string>();
  for (const [path, loader] of entries) {
    const slug = slugFromPath(path);
    if (!slug) continue;
    const previousPath = pathsBySlug.get(slug);
    if (previousPath) {
      throw new Error(`Duplicate preview slug “${slug}” in “${previousPath}” and “${path}”.`);
    }
    pathsBySlug.set(slug, path);
    index.set(slug, loader);
  }
  return index;
}

export async function loadPreviewFromLoader(
  slug: string,
  loader: PreviewLoader,
): Promise<LoadedPreview> {
  const module = (await loader()) as Partial<PreviewModule> | null;
  if (!module?.preview) {
    throw new Error(`Preview “${slug}” does not export a preview definition.`);
  }
  validatePreviewDefinition(module.preview, slug);
  if (typeof module.default !== 'function') {
    throw new Error(`Preview “${slug}” does not export a Svelte component as default.`);
  }
  return { component: module.default, definition: module.preview };
}

const loadersBySlug = createPreviewLoaderIndex(
  Object.entries(previewLoaders) as Array<[string, PreviewLoader]>,
);

export function registerPreviewLoader(slug: string, loader: PreviewLoader): () => void {
  const previous = loadersBySlug.get(slug);
  loadersBySlug.set(slug, loader);
  return () => {
    if (loadersBySlug.get(slug) !== loader) return;
    if (previous) loadersBySlug.set(slug, previous);
    else loadersBySlug.delete(slug);
  };
}

export function listPreviewIds(): string[] {
  return [...loadersBySlug.keys()].sort();
}

export async function loadPreview(slug: string): Promise<LoadedPreview | undefined> {
  const loader = loadersBySlug.get(slug);
  if (!loader) return undefined;
  return loadPreviewFromLoader(slug, loader);
}

export interface ActivePreview {
  slug: string;
  state: string;
  width: number;
  status: 'ready';
  fit?: CatalogPreviewFit;
}

interface PreviewBrowserApi {
  list: () => string[];
  states: (slug: string) => Promise<string[]>;
  current: () => ActivePreview | null;
  probe: (options?: GeometryProbeOptions) => ActivePreviewGeometry | null;
}

type ActivePreviewGeometry = GeometryProbeResult & Pick<ActivePreview, 'slug' | 'state' | 'width'>;

let activePreview: ActivePreview | null = null;

export function setActivePreview(value: ActivePreview | null): void {
  activePreview = value;
}

export function installPreviewBrowserApi(target: Window): () => void {
  const previous = target.__INTENT_PREVIEW__;
  const api: PreviewBrowserApi = {
    list: listPreviewIds,
    states: async (slug) => {
      const loaded = await loadPreview(slug);
      return loaded ? Object.keys(loaded.definition.states) : [];
    },
    current: () => activePreview,
    probe: (options) => {
      if (!activePreview) return null;
      const root = target.document.querySelector<HTMLElement>(
        '[data-preview-ready="true"] [data-testid="catalog-scene-focus"]',
      );
      if (!root) return null;
      const { slug, state, width } = activePreview;
      return { slug, state, width, ...collectGeometry(root, options) };
    },
  };
  target.__INTENT_PREVIEW__ = api;
  return () => {
    if (target.__INTENT_PREVIEW__ === api) target.__INTENT_PREVIEW__ = previous;
  };
}

declare global {
  interface Window {
    __INTENT_PREVIEW__?: PreviewBrowserApi;
  }
}
