import { describe, expect, it } from 'vitest';
import {
  definePreview,
  resolvePreviewState,
  validatePreviewDefinition,
  type PreviewDefinition,
} from './preview-definition';

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

  it('rejects definitions without states', () => {
    expect(() =>
      definePreview({ id: 'empty', title: 'Empty', defaultState: 'default', states: {} }),
    ).toThrow('Preview “empty” must define at least one state.');
  });

  it('rejects a default that is not one of the named states', () => {
    expect(() =>
      definePreview({
        id: 'example',
        title: 'Example',
        defaultState: 'missing',
        states: { default: { props: {} } },
      }),
    ).toThrow('Preview “example” default state “missing” is not defined.');
  });

  it('rejects a definition id that does not match its discovered slug', () => {
    expect(() => validatePreviewDefinition(definition, 'other')).toThrow(
      'Preview slug “other” does not match definition id “example”.',
    );
  });
});
