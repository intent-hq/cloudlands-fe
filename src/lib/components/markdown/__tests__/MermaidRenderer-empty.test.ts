/**
 * MermaidRenderer shows its "no code" state for a source that holds no
 * diagram — empty or blank, plain or base64 as the note renderer stores it —
 * instead of waiting for a diagram it will never draw.
 *
 * marked 18.2 keeps the blank line of a fence such as "~~~mermaid\n\n~~~" as
 * its content ("\n", as CommonMark reads it; 18.0 gave ""), and the note
 * renderer stores that as the base64 "Cg==". Read against the encoded
 * attribute, "Cg==" was no empty source: the block stayed "pending" (a
 * Loading status) after the render had settled on nothing to draw, and kept
 * the note loading.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, waitFor, cleanup } from '@testing-library/svelte';

const { mermaidRender } = vi.hoisted(() => ({
  mermaidRender: vi.fn(async () => ({ svg: '<svg data-testid="diagram"></svg>' })),
}));

vi.mock('mermaid', () => ({
  default: {
    initialize: vi.fn(),
    registerLayoutLoaders: vi.fn(),
    render: mermaidRender,
  },
}));

vi.mock('$store/renderer/slices/theme/theme-selectors', async () => {
  const { createAppStoreMock } = await import('$store/renderer/utils/test-helpers/store-mock');
  const store = createAppStoreMock({ state: {} });
  return { selectIsDarkTheme: store.createSelector(() => false) };
});

import MermaidRenderer from '../MermaidRenderer.svelte';

const base64 = (text: string) => btoa(unescape(encodeURIComponent(text)));

const themeTokens = {
  '--background': '0 0% 100%',
  '--foreground': '0 0% 0%',
  '--card': '0 0% 100%',
  '--card-foreground': '0 0% 0%',
  '--muted': '0 0% 92%',
  '--muted-foreground': '0 0% 36%',
  '--border': '0 0% 82%',
  '--accent': '0 0% 92%',
  '--accent-foreground': '0 0% 0%',
  '--font-ui': 'Inter, sans-serif',
  '--text-caption-size': '0.8125rem',
  '--radius-small': '5px',
};

describe('MermaidRenderer empty source', () => {
  beforeEach(() => {
    for (const [name, value] of Object.entries(themeTokens)) {
      document.documentElement.style.setProperty(name, value);
    }
  });

  afterEach(() => {
    cleanup();
    mermaidRender.mockClear();
  });

  it.each([
    ['empty', ''],
    ['blank', '  \n\t\n'],
    ['base64 of a line feed (a fence holding one blank line)', base64('\n')],
    ['base64 of blanks', base64('  \n  \n')],
  ])('shows the no-code state for a %s source', async (_kind, code) => {
    const states: string[] = [];
    const { container } = render(MermaidRenderer, {
      props: { code, onRenderStateChange: (state: string) => states.push(state) },
    });
    await waitFor(() => expect(container.querySelector('.mermaid-empty')).not.toBeNull());
    expect(states.at(-1)).toBe('empty');
    expect(mermaidRender).not.toHaveBeenCalled();
  });

  it('still renders a base64 source that holds a diagram', async () => {
    const { container } = render(MermaidRenderer, { props: { code: base64('graph TD; A-->B') } });
    await waitFor(() => expect(mermaidRender).toHaveBeenCalled());
    expect(container.querySelector('.mermaid-empty')).toBeNull();
  });
});
