import { setContext } from 'svelte';

export interface PreviewContextEntry<T = unknown> {
  key: unknown;
  value: T;
}

export function previewContext<T>(key: unknown, value: T): PreviewContextEntry<T> {
  return { key, value };
}

export function installPreviewContexts(contexts: readonly PreviewContextEntry[]): void {
  for (const context of contexts) setContext(context.key, context.value);
}
