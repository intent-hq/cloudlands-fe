import type { Component } from 'svelte';

export type PreviewSetup = () => void | (() => void);

export interface PreviewState<Props> {
  props: Props;
  setup?: PreviewSetup;
}

export interface PreviewDefinition<Props> {
  id: string;
  title: string;
  defaultState: string;
  states: Record<string, PreviewState<Props>>;
}

export interface LoadedPreview {
  component: Component<Record<string, unknown>>;
  definition: PreviewDefinition<Record<string, unknown>>;
}

export function definePreview<Props>(
  definition: PreviewDefinition<Props>,
): PreviewDefinition<Props> {
  return definition;
}

export function resolvePreviewState<Props>(
  definition: PreviewDefinition<Props>,
  requestedState?: string,
):
  | { ok: true; name: string; state: PreviewState<Props> }
  | { ok: false; requestedState: string; availableStates: string[] } {
  const name = requestedState || definition.defaultState;
  const state = definition.states[name];
  if (state) return { ok: true, name, state };
  return { ok: false, requestedState: name, availableStates: Object.keys(definition.states) };
}
