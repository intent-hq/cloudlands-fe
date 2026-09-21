import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { compile } from 'svelte/compiler';
import type { NodeViewProps } from '@tiptap/core';
import { Textarea } from '$lib/components/ui/textarea';
import MermaidBlockNodeView from '../MermaidBlockNodeView.svelte';
import componentSource from '../MermaidBlockNodeView.svelte?raw';

// Keep the node view, shared Textarea, bindings and editor handlers real.
vi.mock('$lib/components/markdown/MermaidRenderer.svelte', async () => ({
  default: (await import('./MermaidRendererFullscreenFixture.svelte')).default,
}));

vi.mock('$lib/components/ui/toast', () => ({ toast: { error: vi.fn() } }));

vi.mock('$store/renderer/slices/theme/theme-selectors', async () => {
  const { createAppStoreMock } = await import('$store/renderer/utils/test-helpers/store-mock');
  const store = createAppStoreMock({ state: {} });
  return { selectIsDarkTheme: store.createSelector(() => false) };
});

const originalCode = 'graph TD; A-->B';
const changedCode = 'graph TD; A-->C';
const styles: HTMLStyleElement[] = [];

async function openEditor() {
  const updateAttributes = vi.fn();
  render(MermaidBlockNodeView, {
    props: {
      node: { attrs: { code: originalCode } } as unknown as NodeViewProps['node'],
      selected: false,
      updateAttributes,
    } as NodeViewProps,
  });
  await fireEvent.click(screen.getByRole('button', { name: 'Edit code' }));
  const textarea = screen.getByRole('textbox') as HTMLTextAreaElement;
  await waitFor(() => expect(document.activeElement).toBe(textarea));
  return { textarea, wrapper: textarea.parentElement!, updateAttributes };
}

function compiledRules(wrapper: HTMLElement): CSSStyleRule[] {
  // Vitest does not load component CSS by default. Compile the complete production
  // source and use Vite's mounted scope token (its dev hash differs from compile's
  // default). Do not add the parent's scope to the child textarea: that is the bug.
  const scope = [...wrapper.classList].find((name) => name.startsWith('svelte-'));
  if (!scope) throw new Error('The editor wrapper must have a compiled Svelte scope');
  const { css } = compile(componentSource, {
    filename: 'MermaidBlockNodeView.svelte',
    generate: 'client',
    css: 'external',
    cssHash: () => scope,
  });
  if (!css) throw new Error('The node view must emit its editor stylesheet');
  const style = document.createElement('style');
  style.textContent = css.code;
  styles.push(style);
  document.head.append(style);
  if (!style.sheet) throw new Error('The compiled stylesheet must be parsed');
  return Array.from(style.sheet.cssRules).filter(
    (rule): rule is CSSStyleRule => 'selectorText' in rule,
  );
}

function declaration(rules: CSSStyleRule[], element: Element, property: string) {
  return rules
    .filter((rule) => element.matches(rule.selectorText))
    .map((rule) => rule.style.getPropertyValue(property))
    .filter(Boolean)
    .at(-1);
}

afterEach(() => {
  cleanup();
  for (const style of styles.splice(0)) style.remove();
  vi.clearAllMocks();
});

describe('Mermaid code editor child textarea', () => {
  it('matches compiled overlay styles on the shared textarea, aligned with the highlight layer', async () => {
    const { textarea, wrapper } = await openEditor();
    const rules = compiledRules(wrapper);
    const highlight = wrapper.querySelector('pre')!;

    // These are declarations selected against real mounted DOM, not source-string
    // assertions or mocked geometry. Browser pixel alignment remains a separate gate.
    expect(declaration(rules, wrapper, 'position')).toBe('relative');
    expect(declaration(rules, textarea, 'position')).toBe('absolute');
    expect(declaration(rules, textarea, 'top')).toBe('0');
    expect(declaration(rules, textarea, 'left')).toBe('0');
    expect(declaration(rules, textarea, 'width')).toBe('100%');
    expect(declaration(rules, textarea, 'height')).toBe('100%');
    expect(declaration(rules, textarea, 'font')).toBe('inherit');
    expect(declaration(rules, textarea, 'line-height')).toBe('inherit');
    expect(declaration(rules, textarea, 'color')).toBe('transparent');
    expect(declaration(rules, textarea, 'background')).toBe('transparent');
    expect(declaration(rules, textarea, 'caret-color')).toBe('hsl(var(--foreground))');
    expect(declaration(rules, textarea, 'resize')).toBe('none');
    expect(declaration(rules, textarea, 'overflow')).toBe('hidden');
    for (const layer of [textarea, highlight]) {
      expect(declaration(rules, layer, 'margin')).toBe('0');
      expect(declaration(rules, layer, 'padding')).toBe('0.5rem');
      expect(declaration(rules, layer, 'white-space')).toBe('pre-wrap');
      expect(declaration(rules, layer, 'word-wrap')).toBe('break-word');
    }
  });

  it('matches the focus reset only while focused and confines both rules to this editor', async () => {
    const { textarea, wrapper } = await openEditor();
    const rules = compiledRules(wrapper);
    expect(declaration(rules, textarea, 'outline')).toBe('none');
    textarea.blur();
    expect(declaration(rules, textarea, 'outline')).toBeUndefined();
    textarea.focus();
    expect(declaration(rules, textarea, 'outline')).toBe('none');

    const outside = render(Textarea, { props: { class: 'code-textarea' } });
    // Even an unrelated wrapper with the same class must not receive these styles.
    outside.container.className = 'code-editor-wrapper';
    const otherTextarea = outside.container.querySelector('textarea')!;
    otherTextarea.focus();
    expect(document.activeElement).toBe(otherTextarea);
    expect(declaration(rules, otherTextarea, 'position')).toBeUndefined();
    expect(declaration(rules, otherTextarea, 'outline')).toBeUndefined();
  });

  it('forwards input and Save through the real shared textarea', async () => {
    const { textarea, wrapper, updateAttributes } = await openEditor();
    expect(textarea.value).toBe(originalCode);
    await fireEvent.input(textarea, { target: { value: changedCode } });
    expect(wrapper.querySelector('pre')!.textContent).toBe(`${changedCode}\n`);
    await fireEvent.click(screen.getByRole('button', { name: 'Save', exact: true }));
    expect(updateAttributes).toHaveBeenLastCalledWith({ code: changedCode });
    await waitFor(() => expect(screen.queryByRole('textbox')).toBeNull());
  });

  it('preserves Cancel and Escape keyboard behavior', async () => {
    const { textarea, updateAttributes } = await openEditor();
    await fireEvent.input(textarea, { target: { value: changedCode } });
    await fireEvent.click(screen.getByRole('button', { name: 'Cancel', exact: true }));
    expect(updateAttributes).toHaveBeenLastCalledWith({ code: originalCode });
    expect(textarea.value).toBe(originalCode);
    expect(screen.getByRole('textbox')).toBe(textarea);

    await fireEvent.input(textarea, { target: { value: changedCode } });
    await fireEvent.keyDown(textarea, { key: 'Escape' });
    expect(updateAttributes).toHaveBeenLastCalledWith({ code: originalCode });
    await waitFor(() => expect(screen.queryByRole('textbox')).toBeNull());
  });
});