/** @vitest-environment jsdom */
import { cleanup, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';
import { PREVIEW_FIXTURE_IDS } from '$lib/component-catalog/preview-fixtures';
import StreamingStatus from './StreamingStatus.svelte';
import { preview } from './streaming-status.preview';
import { STREAMING_STATUS_PREVIEW_FIXTURES } from './streaming-status.preview-fixtures';

afterEach(cleanup);

describe('streaming status preview', () => {
  it('publishes deterministic focused chat states', () => {
    expect(preview.id).toBe('streaming-status');
    expect(preview.defaultState).toBe('streaming');
    expect(Object.keys(preview.states)).toEqual([
      'streaming',
      'waiting',
      'error',
      'model-unavailable',
      'long-content',
    ]);
    expect(STREAMING_STATUS_PREVIEW_FIXTURES.streaming.seed).toBe(PREVIEW_FIXTURE_IDS.agent);
    expect(STREAMING_STATUS_PREVIEW_FIXTURES.streaming.statusEvents?.[0]?.timestamp).toBe(
      Date.parse('2026-08-23T12:05:00.000Z'),
    );
  });

  it.each(['streaming', 'waiting'] as const)('renders the %s operational state', (state) => {
    render(StreamingStatus, { props: preview.states[state].props });
    expect(screen.getByRole('status', { name: 'Loading' })).toBeTruthy();
  });

  it.each(['error', 'long-content'] as const)('renders the %s terminal state', (state) => {
    render(StreamingStatus, { props: preview.states[state].props });
    expect(screen.getByRole('alert')).toBeTruthy();
  });
});
