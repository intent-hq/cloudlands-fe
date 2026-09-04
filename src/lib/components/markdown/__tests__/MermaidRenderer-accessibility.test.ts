import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mermaidMocks = vi.hoisted(() => ({
  initialize: vi.fn(),
  registerLayoutLoaders: vi.fn(),
  render: vi.fn(async () => ({ svg: '<svg aria-roledescription="flowchart"></svg>' })),
}));

vi.mock('mermaid', () => ({ default: mermaidMocks }));
vi.mock('@mermaid-js/layout-elk', () => ({ default: [] }));

import MermaidRenderer from '../MermaidRenderer.svelte';

const themeTokens = {
  '--background': '0 0% 100%',
  '--foreground': '0 0% 8%',
  '--card': '0 0% 98%',
  '--card-foreground': '0 0% 8%',
  '--muted': '210 12% 92%',
  '--muted-foreground': '210 8% 35%',
  '--border': '210 10% 82%',
  '--accent': '145 30% 90%',
  '--accent-foreground': '145 50% 20%',
  '--font-ui': 'Inter, system-ui, sans-serif',
  '--text-caption-size': '0.8125rem',
  '--radius-small': '5px',
};

beforeEach(() => {
  for (const [name, value] of Object.entries(themeTokens)) {
    document.documentElement.style.setProperty(name, value);
  }
  mermaidMocks.render.mockResolvedValue({
    svg: '<svg aria-roledescription="flowchart"></svg>',
  });
});

afterEach(() => {
  cleanup();
  for (const name of Object.keys(themeTokens)) {
    document.documentElement.style.removeProperty(name);
  }
});

describe('Mermaid renderer accessibility', () => {
  it('exposes named source and fullscreen actions', async () => {
    render(MermaidRenderer, { props: { code: 'flowchart LR\nA --> B' } });
    const source = await screen.findByRole('button', { name: 'View source' });
    const expand = screen.getByRole('button', { name: 'Expand diagram to fullscreen' });

    source.focus();
    expect(document.activeElement).toBe(source);
    await fireEvent.click(source);
    expect(screen.getByRole('region', { name: 'View source' }).textContent).toContain(
      'flowchart LR',
    );
    expect(source.getAttribute('aria-pressed')).toBe('true');

    await fireEvent.click(expand);
    expect(await screen.findByRole('dialog', { name: 'Fullscreen diagram view' })).toBeTruthy();
  });

  it('gives an empty source a next action', () => {
    render(MermaidRenderer, { props: { code: '' } });
    expect(screen.getByRole('status').textContent).toContain('No diagram code');
    expect(screen.getByRole('status').textContent).toContain('Add Mermaid syntax');
  });

  it('gives invalid Mermaid source recovery guidance and source access', async () => {
    mermaidMocks.render.mockRejectedValueOnce(new Error('Parse error'));
    render(MermaidRenderer, { props: { code: 'flowchart broken' } });

    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain('Failed to render'),
    );
    expect(screen.getByRole('alert').textContent).toContain('Check the Mermaid syntax');
    expect(screen.getByRole('alert').textContent).not.toContain('Parse error');

    const summary = screen.getByText('Technical details');
    const details = summary.closest('details');
    expect(details?.open).toBe(false);
    await fireEvent.click(summary);
    expect(details?.open).toBe(true);
    expect(details?.textContent).toContain('Parse error');
    expect(details?.textContent).toContain('flowchart broken');
  });
});
