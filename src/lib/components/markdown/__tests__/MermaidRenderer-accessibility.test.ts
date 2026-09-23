import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import type { NodeViewProps } from '@tiptap/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mermaidMocks = vi.hoisted(() => ({
  initialize: vi.fn(),
  registerLayoutLoaders: vi.fn(),
  render: vi.fn(async () => ({ svg: '<svg aria-roledescription="flowchart"></svg>' })),
}));

vi.mock('mermaid', () => ({ default: mermaidMocks }));
vi.mock('@mermaid-js/layout-elk', () => ({ default: [] }));

vi.mock('$store/renderer/slices/theme/theme-selectors', async () => {
  const { createAppStoreMock } = await import('$store/renderer/utils/test-helpers/store-mock');
  const store = createAppStoreMock({ state: {} });
  return { selectIsDarkTheme: store.createSelector(() => false) };
});

import MermaidRenderer from '../MermaidRenderer.svelte';
import MermaidBlockNodeView from '../../tiptap/MermaidBlockNodeView.svelte';

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

    await fireEvent.click(source);
    expect(screen.queryByRole('region', { name: 'View source' })).toBeNull();
    expect(source.getAttribute('aria-pressed')).toBe('false');

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

describe('note Mermaid source actions', () => {
  const source = 'flowchart LR\nA["Café & tea"] --> B["Office"]';
  const encode = (code: string) => Buffer.from(code, 'utf8').toString('base64');
  const noteProps = (code: string, isEditable: boolean) =>
    ({
      node: { attrs: { code } },
      selected: false,
      updateAttributes: vi.fn(),
      editor: { isEditable },
    }) as unknown as NodeViewProps;

  it.each(['plain', 'base64'])(
    'uses Edit as the sole %s source action and saves edits',
    async (encoding) => {
      const code = encoding === 'base64' ? encode(source) : source;
      const props = noteProps(code, true);
      const result = render(MermaidBlockNodeView, { props });
      const note = within(result.container);
      await waitFor(() =>
        expect(result.container.querySelector('[data-render-state="rendered"]')).toBeTruthy(),
      );
      expect(note.queryByRole('button', { name: 'View source' })).toBeNull();
      expect(note.queryByRole('region', { name: 'View source' })).toBeNull();

      await fireEvent.click(note.getByRole('button', { name: 'Edit code' }));
      const editor = note.getByRole('textbox') as HTMLTextAreaElement;
      expect(editor.value).toBe(source);
      expect(document.activeElement).toBe(editor);
      const changed = source.replace('Office', 'Home');
      await fireEvent.input(editor, { target: { value: changed } });
      await fireEvent.click(note.getByRole('button', { name: 'Save' }));
      expect(props.updateAttributes).toHaveBeenLastCalledWith({
        code: encoding === 'base64' ? encode(changed) : changed,
      });
      await waitFor(() => expect(note.queryByRole('textbox')).toBeNull());
    },
  );

  it('cancels source edits without losing the encoded original', async () => {
    const props = noteProps(encode(source), true);
    const result = render(MermaidBlockNodeView, { props });
    const note = within(result.container);
    await fireEvent.click(note.getByRole('button', { name: 'Edit code' }));
    const editor = note.getByRole('textbox') as HTMLTextAreaElement;
    await fireEvent.input(editor, { target: { value: 'flowchart LR\nX --> Y' } });
    await fireEvent.click(note.getByRole('button', { name: 'Cancel' }));
    expect(props.updateAttributes).toHaveBeenLastCalledWith({ code: encode(source) });
    expect(editor.value).toBe(source);
    await fireEvent.keyDown(editor, { key: 'Escape' });
    await waitFor(() => expect(note.queryByRole('textbox')).toBeNull());
  });

  it('toggles only the targeted read-only note source in the shared action row', async () => {
    const first = render(MermaidBlockNodeView, { props: noteProps(encode(source), false) });
    const second = render(MermaidBlockNodeView, {
      props: noteProps('flowchart LR\nOther --> Diagram', false),
    });
    const firstNote = within(first.container);
    const secondNote = within(second.container);
    const trigger = await firstNote.findByRole('button', { name: 'View source' });
    await secondNote.findByRole('button', { name: 'View source' });
    expect(firstNote.queryByRole('button', { name: 'Edit code' })).toBeNull();
    trigger.focus();
    expect(document.activeElement).toBe(trigger);
    expect(trigger.getAttribute('aria-pressed')).toBe('false');
    await fireEvent.click(trigger);
    expect(trigger.getAttribute('aria-pressed')).toBe('true');
    expect(firstNote.getByRole('region', { name: 'View source' }).textContent).toBe(source);
    expect(secondNote.queryByRole('region', { name: 'View source' })).toBeNull();
    await fireEvent.click(trigger);
    expect(trigger.getAttribute('aria-pressed')).toBe('false');
    expect(firstNote.queryByRole('region', { name: 'View source' })).toBeNull();
  });
});
