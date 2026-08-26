import type { Component } from 'svelte';

type PreviewSetup = () => void | (() => void);

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

export function validatePreviewDefinition<Props>(
  definition: PreviewDefinition<Props>,
  expectedId?: string,
): PreviewDefinition<Props> {
  if (expectedId !== undefined && definition.id !== expectedId) {
    throw new Error(
      `Preview slug “${expectedId}” does not match definition id “${definition.id}”.`,
    );
  }

  const states = definition.states && Object.keys(definition.states);
  if (!states || states.length === 0) {
    throw new Error(`Preview “${definition.id}” must define at least one state.`);
  }
  if (!Object.prototype.hasOwnProperty.call(definition.states, definition.defaultState)) {
    throw new Error(
      `Preview “${definition.id}” default state “${definition.defaultState}” is not defined.`,
    );
  }
  return definition;
}

export function definePreview<Props>(
  definition: PreviewDefinition<Props>,
): PreviewDefinition<Props> {
  return validatePreviewDefinition(definition);
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
