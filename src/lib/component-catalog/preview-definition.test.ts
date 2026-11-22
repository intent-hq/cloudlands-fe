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

  it('rejects the reserved "all" state name, which the scene uses for every state', () => {
    expect(() =>
      definePreview({
        id: 'example',
        title: 'Example',
        defaultState: 'default',
        states: {
          default: { props: {} },
          // @ts-expect-error -- "all" is reserved for the all-states scene.
          all: { props: {} },
        },
      }),
    ).toThrow(
      'Preview “example” cannot name a state “all”: the sandbox reserves it to show every state.',
    );
  });

  it('rejects the reserved state name in discovered previews that bypass the type', () => {
    const untyped = {
      ...definition,
      states: { ...definition.states, all: { props: { label: 'All' } } },
    } as unknown as PreviewDefinition<{ label: string }>;

    expect(() => validatePreviewDefinition(untyped, 'example')).toThrow(
      'Preview “example” cannot name a state “all”',
    );
  });

  it('rejects a definition id that does not match its discovered slug', () => {
    expect(() => validatePreviewDefinition(definition, 'other')).toThrow(
      'Preview slug “other” does not match definition id “example”.',
    );
  });

  it('preserves a valid readiness timeout', () => {
    const withTimeout = definePreview({
      ...definition,
      captureReadiness: { selector: '[data-ready="true"]', readinessTimeoutMs: 24_000 },
    });

    expect(withTimeout.captureReadiness?.readinessTimeoutMs).toBe(24_000);
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY, '24000'])(
    'rejects invalid readiness timeout %s',
    (readinessTimeoutMs) => {
      expect(() =>
        definePreview({
          ...definition,
          captureReadiness: {
            selector: '[data-ready="true"]',
            readinessTimeoutMs,
          },
        } as PreviewDefinition<{ label: string }>),
      ).toThrow('Preview “example” readiness timeout must be a positive number.');
    },
  );
});
