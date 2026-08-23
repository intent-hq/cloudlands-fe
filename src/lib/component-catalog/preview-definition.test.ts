import { describe, expect, it } from 'vitest';
import { resolvePreviewState, type PreviewDefinition } from './preview-definition';

const definition: PreviewDefinition<{ label: string }> = {
  id: 'example',
  title: 'Example',
  defaultState: 'default',
  states: {
    default: { props: { label: 'Ready' } },
    loading: { props: { label: 'Loading' } },
    error: { props: { label: 'Error' } },
  },
};

describe('preview definitions', () => {
  it('uses the named state or deterministic default', () => {
    expect(resolvePreviewState(definition).ok).toBe(true);
    expect(resolvePreviewState(definition, 'loading')).toMatchObject({
      ok: true,
      name: 'loading',
      state: { props: { label: 'Loading' } },
    });
  });

  it('reports invalid states without silently changing the requested scene', () => {
    expect(resolvePreviewState(definition, 'missing')).toEqual({
      ok: false,
      requestedState: 'missing',
      availableStates: ['default', 'loading', 'error'],
    });
  });
});
