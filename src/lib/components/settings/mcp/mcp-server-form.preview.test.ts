/** @vitest-environment jsdom */
import { cleanup, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';
import { PREVIEW_FIXTURE_IDS } from '$lib/component-catalog/preview-fixtures';
import McpServerForm from './McpServerForm.svelte';
import { preview } from './mcp-server-form.preview';

afterEach(cleanup);

describe('MCP server form preview', () => {
  it('publishes deterministic settings states without setup side effects', () => {
    expect(preview.id).toBe('mcp-server-form');
    expect(Object.keys(preview.states)).toEqual([
      'empty',
      'validation',
      'configured-http',
      'long-content',
    ]);
    expect(preview.states.validation.props.initialValues?.name).toBe(PREVIEW_FIXTURE_IDS.agent);
    expect(Object.values(preview.states).every((state) => state.setup === undefined)).toBe(true);
  });

  it('renders the duplicate-name validation state', () => {
    render(McpServerForm, { props: preview.states.validation.props });
    expect(screen.getByDisplayValue(PREVIEW_FIXTURE_IDS.agent)).toBeTruthy();
    expect(screen.getByText(/already exists/i)).toBeTruthy();
  });

  it('renders the configured HTTP settings state', () => {
    render(McpServerForm, { props: preview.states['configured-http'].props });
    expect(screen.getByDisplayValue('https://mcp.preview.invalid/rpc')).toBeTruthy();
    expect(screen.getByDisplayValue('X-Preview-Mode')).toBeTruthy();
    expect(screen.getByDisplayValue('deterministic')).toBeTruthy();
  });
});
