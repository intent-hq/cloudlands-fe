import type { Component } from 'svelte';
import type { LoadedPreview, PreviewDefinition } from './preview-definition';

type PreviewModule = {
  default: Component<Record<string, unknown>>;
  preview: PreviewDefinition<Record<string, unknown>>;
};

const previewLoaders = import.meta.glob(['/src/**/*.preview.ts', '/src/**/*.preview.svelte']);

function slugFromPath(path: string): string | undefined {
  return path.match(/\/([^/]+)\.preview\.(?:ts|svelte)$/)?.[1];
}

const loadersBySlug = new Map(
  Object.entries(previewLoaders).flatMap(([path, loader]) => {
    const slug = slugFromPath(path);
    return slug ? [[slug, loader] as const] : [];
  }),
);

export function listPreviewIds(): string[] {
  return [...loadersBySlug.keys()].sort();
}

export async function loadPreview(slug: string): Promise<LoadedPreview | undefined> {
  const loader = loadersBySlug.get(slug);
  if (!loader) return undefined;
  const module = (await loader()) as PreviewModule;
  if (!module.preview || module.preview.id !== slug || typeof module.default !== 'function') {
    return undefined;
  }
  return { component: module.default, definition: module.preview };
}

export interface ActivePreview {
  slug: string;
  state: string;
  width: number;
  status: 'ready';
}

export interface PreviewBrowserApi {
  list: () => string[];
  states: (slug: string) => Promise<string[]>;
  current: () => ActivePreview | null;
}

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
