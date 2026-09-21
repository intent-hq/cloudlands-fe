// @vitest-environment jsdom
import { render } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import { parseUiComponentMetadata } from '../component-metadata';
import TableHarness from './TableHarness.svelte';
import { tableMetadata } from './table.meta';

describe('Table', () => {
  it('renders semantic rows, headers, and numeric cells', () => {
    const { getByRole } = render(TableHarness);
    expect(getByRole('table', { name: 'Workspace usage' })).toBeTruthy();
    expect(getByRole('columnheader', { name: 'Workspace' })).toBeTruthy();
    expect(getByRole('cell', { name: '84' })).toBeTruthy();
  });

  it('publishes valid catalog metadata', () => {
    expect(() => parseUiComponentMetadata(tableMetadata)).not.toThrow();
  });
});
